import type { SpeakerDecision } from '../../types/index.js';
import type { DirectAddressInput, SpeakerAssessment, SpeakerSelectionInput } from '../../types/flow.types.js';
import { HIGH_ENGAGEMENT_SCORE, MAX_CONSECUTIVE_DIRECT } from '../../constants/flow.constants.js';

/** 単一ペルソナが高意欲か（>= HIGH_ENGAGEMENT_SCORE）。キュー追加・キュー選択ゲートと共有 */
export const isHighEngagement = (assessment: { score: number }): boolean =>
	assessment.score >= HIGH_ENGAGEMENT_SCORE;

/** 集合に高意欲のペルソナが1人でもいるか。B ゲート・キュー選択・活性シグナルで共有 */
export const hasHighEngagement = (assessments: ReadonlyArray<{ score: number }>): boolean =>
	assessments.some(isHighEngagement);

/** ターン冒頭: 前ターン由来の指名・直接質問で次話者が確定するか判定する */
export const resolveDirectAddress = (input: DirectAddressInput): SpeakerDecision | null => {
	const { pendingAddress, consecutiveDirectExchanges, personaIds } = input;
	if (!pendingAddress) return null;
	if (!personaIds.includes(pendingAddress.personaId)) return null;

	if (pendingAddress.byFacilitator) {
		return { personaId: pendingAddress.personaId, source: 'nomination' };
	}
	if (consecutiveDirectExchanges >= MAX_CONSECUTIVE_DIRECT) return null;
	return { personaId: pendingAddress.personaId, source: 'direct_address' };
};

/** 選ばれた話者の発言は本人の意欲評価に従う（mode と score→長さ）。選ばれた以上は必ず発言するため none・低スコアは最小発言（score 2 / opinion）に切り上げる */
export const speechFromAssessment = (assessment?: {
	mode: 'opinion' | 'fact' | 'none';
	score: number;
}): { mode?: 'opinion' | 'fact'; score?: number } => {
	if (!assessment) return {};
	if (assessment.mode === 'none') return { mode: 'opinion', score: 2 };
	return { mode: assessment.mode, score: Math.max(2, assessment.score) };
};

/** 評価後: キュー > スコアの2段で次話者を決定する */
export const decideNextSpeaker = (input: SpeakerSelectionInput): SpeakerDecision => {
	const { pendingIntents, silenceMap, lastSpeakerId, personaIds } = input;
	const assessments = input.assessments.filter((a) => personaIds.includes(a.personaId));

	const byScoreThenSilence = (a: SpeakerAssessment, b: SpeakerAssessment) =>
		b.score !== a.score
			? b.score - a.score
			: (silenceMap.get(b.personaId) ?? 0) - (silenceMap.get(a.personaId) ?? 0);

	// (1) 高意欲者なし（キュー選択ゲート、追加と同一境界を逆向きに使う）→ キューの最古エントリ保持者（直前話者を除く）
	if (!hasHighEngagement(assessments)) {
		let oldestIdx = Infinity;
		let oldestPersonaId: string | undefined;
		for (const [personaId, items] of pendingIntents.entries()) {
			if (personaId === lastSpeakerId || !personaIds.includes(personaId) || items.length === 0)
				continue;
			const oldest = Math.min(...items.map((item) => item.triggerTurnIndex));
			if (oldest < oldestIdx) {
				oldestIdx = oldest;
				oldestPersonaId = personaId;
			}
		}
		if (oldestPersonaId) {
			const items = [...(pendingIntents.get(oldestPersonaId) ?? [])].sort(
				(a, b) => a.triggerTurnIndex - b.triggerTurnIndex
			);
			return {
				personaId: oldestPersonaId,
				source: 'queue',
				intentSummary: items[0]?.intentSummary
			};
		}
	}

	// (2) スコア降順（同点は沈黙優先）。直前話者は唯一の最高スコアでない限り回避
	const sorted = [...assessments].sort(byScoreThenSilence);
	if (sorted.length === 0) {
		const fallbackId = personaIds.find((id) => id !== lastSpeakerId) ?? personaIds[0];
		return { personaId: fallbackId, source: 'score' };
	}
	const maxScore = sorted[0].score;
	const isLastSpeakerUniqueTop =
		sorted[0].personaId === lastSpeakerId &&
		sorted.filter((a) => a.score === maxScore).length === 1;
	const selected = isLastSpeakerUniqueTop
		? sorted[0]
		: (sorted.find((a) => a.personaId !== lastSpeakerId) ?? sorted[0]);
	return { personaId: selected.personaId, source: 'score' };
};
