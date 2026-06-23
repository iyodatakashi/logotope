import type {
	SpeakerSelection,
	Engagement,
	QueuedIntent,
	DebateState,
	DebateTurn
} from '../../types/debate.types.js';
import type { Persona } from '../../types/persona.types.js';
import {
	QUEUE_THRESHOLD_SCORE,
	SPEAK_THRESHOLD_SCORE,
	STALL_INTERVENTION_THRESHOLD_SCORE
} from '../../constants/debate.constants.js';

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
	engagements,
	state,
	personas
}: {
	targetPersona: { personaId: string; targetedBy: 'facilitator' | 'persona' } | undefined;
	engagements: ReadonlyArray<Engagement>;
	state: DebateState;
	personas: ReadonlyArray<Persona>;
}): SpeakerSelection => {
	if (targetPersona) {
		return {
			personaId: targetPersona.personaId,
			reason:
				targetPersona.targetedBy === 'facilitator'
					? 'targeted_by_facilitator'
					: 'targeted_by_persona'
		};
	}
	const personaIds = personas.map((p) => p.id);
	return selectSpeakerByEngagement(
		engagements,
		state.queuedIntents,
		state.silenceMap,
		personaIds,
		state.turns,
		state.lastSpeakerId
	);
};

/** 発話モードの優先度。事実提示(fact) > 質問(question) > 意見(opinion/none)。同点時のタイブレークに使う */
const getModeRank = (mode: string): number => (mode === 'fact' ? 2 : mode === 'question' ? 1 : 0);

/** キュー > スコアの2段で話者を決定する */
const selectSpeakerByEngagement = (
	engagements: ReadonlyArray<Engagement>,
	queuedIntents: ReadonlyMap<string, ReadonlyArray<QueuedIntent>>,
	silenceMap: ReadonlyMap<string, number>,
	personaIds: ReadonlyArray<string>,
	turns: ReadonlyArray<DebateTurn>,
	lastSpeakerId?: string
): SpeakerSelection => {
	// 現在この章に参加しているペルソナの評価だけに絞る
	const filteredAssessments = engagements.filter((a) => personaIds.includes(a.personaId));

	const getSilence = (a: Engagement) => silenceMap.get(a.personaId) ?? 0;
	// スコア降順 → 沈黙が長い順 → モード優先度の順で並べる比較関数
	const byScoreThenSilenceThenMode = (a: Engagement, b: Engagement) => {
		if (b.score !== a.score) return b.score - a.score;
		if (getSilence(b) !== getSilence(a)) return getSilence(b) - getSilence(a);
		return getModeRank(b.mode) - getModeRank(a.mode);
	};

	// (1) キュー選択ゲート: 今このターンで自発的に発言したい者（閾値超え）が誰もいない場合のみ作動する。
	//     過去に発言したかったが順番が回ってこなかった人を救済するため、キューに最も古い意図を
	//     持つペルソナを選ぶ（直前話者は連続発言回避のため除外）
	if (!shouldSpeak(filteredAssessments)) {
		let oldestIdx = Infinity;
		let oldestPersonaId: string | undefined;
		for (const [personaId, items] of queuedIntents.entries()) {
			if (personaId === lastSpeakerId || !personaIds.includes(personaId) || items.length === 0)
				continue;
			// このペルソナのキュー内で最も古いトリガーターン位置を求める
			const oldest = Math.min(
				...items.map((item) => {
					const idx = turns.findIndex((t) => t.id === item.triggerTurnId);
					return idx === -1 ? Infinity : idx;
				})
			);
			if (oldest < oldestIdx) {
				oldestIdx = oldest;
				oldestPersonaId = personaId;
			}
		}
		if (oldestPersonaId) {
			// 選ばれた人のキューを古い順に並べ、先頭の意図サマリを発言の手がかりとして渡す
			const items = [...(queuedIntents.get(oldestPersonaId) ?? [])].sort((a, b) => {
				const idxA = turns.findIndex((t) => t.id === a.triggerTurnId);
				const idxB = turns.findIndex((t) => t.id === b.triggerTurnId);
				return idxA - idxB;
			});
			return {
				personaId: oldestPersonaId,
				reason: 'queue',
				intentSummary: items[0]?.intentSummary
			};
		}
	}

	// (2) スコア降順 → 沈黙優先 → モード優先（fact>question>opinion）→ 同点はランダム
	//     直前話者は唯一の最高スコアでない限り回避
	const sorted = [...filteredAssessments].sort(byScoreThenSilenceThenMode);
	if (sorted.length === 0) {
		const fallbackId = personaIds.find((id) => id !== lastSpeakerId) ?? personaIds[0];
		return { personaId: fallbackId, reason: 'score' };
	}
	const maxScore = sorted[0].score;
	// 直前話者が「単独の」最高スコアのときだけ連続発言を許す（他に並ぶ者がいないため）
	const isLastSpeakerUniqueTop =
		sorted[0].personaId === lastSpeakerId &&
		sorted.filter((a) => a.score === maxScore).length === 1;

	// 同率トップ（スコア・沈黙・モードがすべて同点）の候補プールを作り、その中から後段でランダム抽選する
	const pool = (() => {
		if (isLastSpeakerUniqueTop) return [sorted[0]];
		const candidates = sorted.filter((a) => a.personaId !== lastSpeakerId);
		const best = candidates[0];
		if (!best) return [sorted[0]]; // 直前話者を除くと候補が消える場合は連続でも許容
		return candidates.filter(
			(a) =>
				a.score === best.score &&
				getSilence(a) === getSilence(best) &&
				getModeRank(a.mode) === getModeRank(best.mode)
		);
	})();

	// 同率の候補が複数いれば偏りを避けてランダムに1人選ぶ
	const selected = pool[Math.floor(Math.random() * pool.length)];
	return { personaId: selected.personaId, reason: 'score' };
};
