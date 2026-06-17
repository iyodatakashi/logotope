import type { SpeakerSelection, Engagement, QueuedIntent, DebateState } from '../../types/debate.types.js';
import type { Persona } from '../../types/persona.types.js';
import { QUEUE_THRESHOLD_SCORE, SPEAK_THRESHOLD_SCORE, STALL_INTERVENTION_THRESHOLD_SCORE } from '../../constants/debate.constants.js';

/** 単一ペルソナの発言意図をキューに積むべきか（>= QUEUE_THRESHOLD_SCORE） */
export const shouldQueue = (engagement: { score: number }): boolean =>
	engagement.score >= QUEUE_THRESHOLD_SCORE;

/** 集合に自発発言すべきペルソナが1人でもいるか（>= SPEAK_THRESHOLD_SCORE）。話者選択ゲートで使用 */
export const shouldSpeak = (engagements: ReadonlyArray<{ score: number }>): boolean =>
	engagements.some((a) => a.score >= SPEAK_THRESHOLD_SCORE);

/** 高意欲者（>= STALL_INTERVENTION_THRESHOLD_SCORE）が1人でもいるか。スタール介入ゲートで使用 */
export const hasHighEngagement = (engagements: ReadonlyArray<{ score: number }>): boolean =>
	engagements.some((a) => a.score >= STALL_INTERVENTION_THRESHOLD_SCORE);

/** 指名があればそれを優先し、なければキュー > スコアで話者を決定する */
export const selectSpeaker = ({
	targetPersona,
	canContinuePairConversation,
	engagements,
	state,
	personas
}: {
	targetPersona: { personaId: string; targetedBy: 'facilitator' | 'persona' } | undefined;
	canContinuePairConversation: boolean;
	engagements: ReadonlyArray<Engagement>;
	state: DebateState;
	personas: ReadonlyArray<Persona>;
}): SpeakerSelection => {
	if (targetPersona && (targetPersona.targetedBy === 'facilitator' || canContinuePairConversation)) {
		return {
			personaId: targetPersona.personaId,
			reason: targetPersona.targetedBy === 'facilitator' ? 'targeted_by_facilitator' : 'targeted_by_persona'
		};
	}
	const personaIds = personas.map((p) => p.id);
	return selectSpeakerByEngagement(engagements, state.queuedIntents, state.silenceMap, personaIds, state.lastSpeakerId);
};

/** キュー > スコアの2段で話者を決定する */
const selectSpeakerByEngagement = (
	engagements: ReadonlyArray<Engagement>,
	queuedIntents: ReadonlyMap<string, ReadonlyArray<QueuedIntent>>,
	silenceMap: ReadonlyMap<string, number>,
	personaIds: ReadonlyArray<string>,
	lastSpeakerId?: string
): SpeakerSelection => {
	const filteredAssessments = engagements.filter((a) => personaIds.includes(a.personaId));

	const byScoreThenSilence = (a: Engagement, b: Engagement) =>
		b.score !== a.score
			? b.score - a.score
			: (silenceMap.get(b.personaId) ?? 0) - (silenceMap.get(a.personaId) ?? 0);

	// (1) 高意欲者なし（キュー選択ゲート、追加と同一境界を逆向きに使う）→ キューの最古エントリ保持者（直前話者を除く）
	if (!shouldSpeak(filteredAssessments)) {
		let oldestIdx = Infinity;
		let oldestPersonaId: string | undefined;
		for (const [personaId, items] of queuedIntents.entries()) {
			if (personaId === lastSpeakerId || !personaIds.includes(personaId) || items.length === 0)
				continue;
			const oldest = Math.min(...items.map((item) => item.triggerTurnIndex));
			if (oldest < oldestIdx) {
				oldestIdx = oldest;
				oldestPersonaId = personaId;
			}
		}
		if (oldestPersonaId) {
			const items = [...(queuedIntents.get(oldestPersonaId) ?? [])].sort(
				(a, b) => a.triggerTurnIndex - b.triggerTurnIndex
			);
			return {
				personaId: oldestPersonaId,
				reason: 'queue',
				intentSummary: items[0]?.intentSummary
			};
		}
	}

	// (2) スコア降順（同点は沈黙優先）。直前話者は唯一の最高スコアでない限り回避
	const sorted = [...filteredAssessments].sort(byScoreThenSilence);
	if (sorted.length === 0) {
		const fallbackId = personaIds.find((id) => id !== lastSpeakerId) ?? personaIds[0];
		return { personaId: fallbackId, reason: 'score' };
	}
	const maxScore = sorted[0].score;
	const isLastSpeakerUniqueTop =
		sorted[0].personaId === lastSpeakerId &&
		sorted.filter((a) => a.score === maxScore).length === 1;
	const selected = isLastSpeakerUniqueTop
		? sorted[0]
		: (sorted.find((a) => a.personaId !== lastSpeakerId) ?? sorted[0]);
	return { personaId: selected.personaId, reason: 'score' };
};
