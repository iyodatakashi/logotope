import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import type { Persona, AwarenessForFirestore } from '../../types/persona.types.js';
import type { AwarenessEvent } from '../../types/debate.types.js';

const db = () => getFirestore();

/** ペルソナの不変の信念（beliefs[0]）を返す。未保持なら空文字 */
export const getBelief = (persona: Persona): string => persona.beliefs?.[0]?.content ?? '';

/**
 * 傾聴で検出した気づきを非破壊で追記する。
 * arrayUnion で Firestore の awarenesses へ原子的に追記しつつ、
 * 渡された persona の in-memory awarenesses も同一参照で更新する
 * （engagement→話者選択→generateTurn へ同一 persona が流れ、直前の気づきが即反映される）。
 */
export const appendAwareness = async (args: {
	topicId: string;
	persona: Persona;
	turnId: string;
	awareness: AwarenessEvent;
}): Promise<void> => {
	const { topicId, persona, turnId, awareness } = args;
	const entry: AwarenessForFirestore = {
		id: nanoid(),
		kind: awareness.kind,
		content: awareness.content,
		sourcePersonaId: awareness.sourcePersonaId,
		triggeredByTurnId: turnId,
		createdAt: Timestamp.now()
	};
	await db()
		.doc(`topics/${topicId}/personas/${persona.id}`)
		.update({ awarenesses: FieldValue.arrayUnion(entry) });
	if (persona.awarenesses) persona.awarenesses.push(entry);
	else persona.awarenesses = [entry];
};

/** 破棄したターンに紐づく awareness を各ペルソナからまとめて巻き戻す（restart 固有のバルク操作） */
export const rollbackAwarenessesForRemovedTurns = async (
	topicId: string,
	removedTurnIds: Set<string>
): Promise<void> => {
	const personasSnap = await db().collection(`topics/${topicId}/personas`).get();
	for (const personaSnap of personasSnap.docs) {
		const pdata = personaSnap.data() as { awarenesses?: Array<{ triggeredByTurnId?: string }> };
		const awarenesses = pdata.awarenesses ?? [];
		const filtered = awarenesses.filter(
			(awareness) =>
				!(awareness.triggeredByTurnId && removedTurnIds.has(awareness.triggeredByTurnId))
		);
		if (filtered.length !== awarenesses.length) {
			await personaSnap.ref.update({ awarenesses: filtered });
		}
	}
};
