import { getFirestore } from 'firebase-admin/firestore';
import { evaluateEngagement } from '../../agents/persona-agent.js';
import type { Engagement, DebateState, DebateTurn } from '../../types/debate.types.js';
import type { Persona } from '../../types/persona.types.js';

const db = () => getFirestore();

/**
 * 各ペルソナの意欲評価を engagements ドキュメントの history.<turnId> に保存する。
 * mergeFields で当該ターンのエントリだけを更新し、既存の queuedIntents 等は壊さない。
 */
const saveEngagements = async (params: {
	topicId: string;
	chapterId: string;
	turnId: string;
	engagements: Array<{
		personaId: string;
		score: number;
		mode: 'opinion' | 'fact' | 'none' | 'question';
		intentSummary?: string;
	}>;
}): Promise<void> => {
	for (const engagement of params.engagements) {
		const ref = db().doc(
			`topics/${params.topicId}/chapters/${params.chapterId}/engagements/${engagement.personaId}`
		);
		const entry: Record<string, unknown> = { score: engagement.score, mode: engagement.mode };
		if (engagement.intentSummary !== undefined) entry.intentSummary = engagement.intentSummary;
		await ref.set(
			{ history: { [params.turnId]: entry } },
			{ mergeFields: [`history.${params.turnId}`] }
		);
	}
};

export const evaluateEngagements = async ({
	topicId,
	chapterId,
	personas,
	state,
	chapterTurns
}: {
	topicId: string;
	chapterId: string;
	personas: Persona[];
	state: DebateState;
	chapterTurns: ReadonlyArray<DebateTurn>;
}): Promise<Engagement[]> => {
	// 直前話者は連続発言させないため評価対象から外す（必要なら後で個別フォールバック評価する）
	const assessTargets = personas.filter((p) => p.id !== state.lastSpeakerId);
	// 全対象を並列に意欲評価する
	const engagements = await Promise.all(
		assessTargets.map((p) => {
			const otherPersonaNames = personas.filter((q) => q.id !== p.id).map((q) => q.name);
			return evaluateEngagement(p, [...chapterTurns], otherPersonaNames, personas);
		})
	);
	await saveEngagements({
		topicId,
		chapterId,
		turnId: chapterTurns[chapterTurns.length - 1]?.id ?? '',
		engagements: engagements.map((a) => ({
			personaId: a.personaId,
			score: a.score,
			mode: a.mode,
			intentSummary: a.intentSummary
		}))
	});
	return engagements;
};

/** engagements に含まれない話者（直前話者など）を個別評価してフォールバックする */
export const evaluateEngagementWithFallback = async ({
	personaId,
	personas,
	chapterTurns,
	engagements = []
}: {
	personaId: string;
	personas: Persona[];
	chapterTurns: ReadonlyArray<DebateTurn>;
	engagements?: Engagement[];
}): Promise<Engagement> => {
	// 一括評価の結果に含まれていればそれを使う（再評価を避ける）
	const fromList = engagements.find((a) => a.personaId === personaId);
	if (fromList) return fromList;
	const persona = personas.find((p) => p.id === personaId);
	// ペルソナが見つからない異常系は中間値 score=2 を返して処理を継続させる
	if (!persona) return { personaId, mode: 'opinion' as const, score: 2 };
	const otherPersonaNames = personas.filter((p) => p.id !== personaId).map((p) => p.name);
	return evaluateEngagement(persona, [...chapterTurns], otherPersonaNames, personas);
};
