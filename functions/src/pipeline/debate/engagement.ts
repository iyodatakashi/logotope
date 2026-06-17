import { getFirestore } from 'firebase-admin/firestore';
import { evaluateEngagement } from '../../agents/persona-agent.js';
import type { Engagement, DebateState } from '../../types/debate.types.js';
import type { Persona } from '../../types/persona.types.js';

const db = () => getFirestore();

const saveEngagements = async (params: {
	topicId: string;
	turnIndex: number;
	engagements: Array<{
		personaId: string;
		score: number;
		mode: 'opinion' | 'fact' | 'none';
		intentSummary?: string;
	}>;
}): Promise<void> => {
	for (const engagement of params.engagements) {
		const ref = db().doc(`topics/${params.topicId}/sessions/0/engagements/${engagement.personaId}`);
		const entry: Record<string, unknown> = { score: engagement.score, mode: engagement.mode };
		if (engagement.intentSummary !== undefined) entry.intentSummary = engagement.intentSummary;
		await ref.set(
			{ history: { [String(params.turnIndex)]: entry } },
			{ mergeFields: [`history.${params.turnIndex}`] }
		);
	}
};

export const evaluateEngagements = async ({
	topicId,
	personas,
	state
}: {
	topicId: string;
	personas: Persona[];
	state: DebateState;
}): Promise<Engagement[]> => {
	const assessTargets = personas.filter((p) => p.id !== state.lastSpeakerId);
	const engagements = await Promise.all(
		assessTargets.map((p) => evaluateEngagement(p, state.turns))
	);
	await saveEngagements({
		topicId,
		turnIndex: Math.max(0, state.turns.length - 1),
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
	turns,
	engagements = []
}: {
	personaId: string;
	personas: Persona[];
	turns: DebateState['turns'];
	engagements?: Engagement[];
}): Promise<Engagement> => {
	const fromList = engagements.find((a) => a.personaId === personaId);
	if (fromList) return fromList;
	const persona = personas.find((p) => p.id === personaId);
	if (!persona) return { personaId, mode: 'opinion' as const, score: 2 };
	return evaluateEngagement(persona, turns);
};
