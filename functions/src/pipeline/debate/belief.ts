import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import type { BeliefChangeEvent } from '../../types/debate.types.js';
import type { Persona } from '../../types/persona.types.js';

const db = () => getFirestore();

const personaDocRef = (topicId: string, personaId: string) =>
	db().doc(`topics/${topicId}/personas/${personaId}`);

/** ペルソナの最新 version の belief を返す。未保持なら version 0 の空 belief */
export const getLatestBelief = (persona: Persona): { content: string; version: number } => {
	const beliefs = persona.beliefs ?? [];
	if (beliefs.length === 0) return { content: '', version: 0 };
	return beliefs.reduce((best, b) => (b.version > best.version ? b : best));
};

/**
 * 信念変化を新 version として arrayUnion で永続化し、引数 persona の in-memory beliefs も更新する。
 * version は現最新 +1。
 */
export const applyBeliefChange = async ({
	topicId,
	persona,
	turnId,
	beliefChange
}: {
	topicId: string;
	persona: Persona;
	turnId: string;
	beliefChange: BeliefChangeEvent;
}): Promise<void> => {
	const belief = getLatestBelief(persona);
	const newVersion = belief.version + 1;
	const id = nanoid();
	const beliefEntry: Record<string, unknown> = {
		id,
		version: newVersion,
		content: beliefChange.updatedBelief,
		createdAt: Timestamp.now()
	};
	if (beliefChange.type !== undefined) beliefEntry.changeType = beliefChange.type;
	if (beliefChange.summary !== undefined) beliefEntry.changeSummary = beliefChange.summary;
	if (turnId !== undefined) beliefEntry.triggeredByTurnId = turnId;
	await personaDocRef(topicId, persona.id).update({
		beliefs: FieldValue.arrayUnion(beliefEntry)
	});
	persona.beliefs = [
		...(persona.beliefs ?? []),
		{
			id,
			version: newVersion,
			content: beliefChange.updatedBelief,
			changeType: beliefChange.type,
			changeSummary: beliefChange.summary,
			triggeredByTurnId: turnId,
			createdAt: Timestamp.now()
		}
	];
};
