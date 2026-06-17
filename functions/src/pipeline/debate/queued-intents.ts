import { getFirestore } from 'firebase-admin/firestore';
import { shouldQueue } from './speaker-selection.js';
import { INTENT_EXPIRY_TURNS } from '../../constants/debate.constants.js';
import type { DebateState, QueuedIntent, SpeakerSelection, Engagement } from '../../types/debate.types.js';

const db = () => getFirestore();

export const expireQueuedIntents = async ({
	topicId,
	state
}: {
	topicId: string;
	state: DebateState;
}): Promise<void> => {
	const writes: Array<{ personaId: string; alive: QueuedIntent[] }> = [];
	for (const [personaId, items] of state.queuedIntents.entries()) {
		const alive = items.filter(
			(item) => state.turns.length - item.triggerTurnIndex <= INTENT_EXPIRY_TURNS
		);
		if (alive.length === items.length) continue;
		if (alive.length === 0) {
			state.queuedIntents.delete(personaId);
		} else {
			state.queuedIntents.set(personaId, alive);
			writes.push({ personaId, alive });
		}
	}
	await Promise.all(
		writes.map(({ personaId, alive }) =>
			db()
				.doc(`topics/${topicId}/sessions/0/engagements/${personaId}`)
				.set({ pendingIntents: alive }, { merge: true })
		)
	);
};

/** 高意欲かつ非選択ペルソナのインテントをキューに追加し Firestore に write-through する */
export const addQueuedIntents = async ({
	topicId,
	state,
	engagements,
	speakerSelection,
	triggerTurnIndex
}: {
	topicId: string;
	state: DebateState;
	engagements: readonly Engagement[];
	speakerSelection: SpeakerSelection;
	triggerTurnIndex: number;
}): Promise<void> => {
	const updates = engagements
		.filter((e) => shouldQueue(e) && e.personaId !== speakerSelection.personaId)
		.map((e) => {
			const existing = state.queuedIntents.get(e.personaId) ?? [];
			const updated = [...existing, { triggerTurnIndex, intentSummary: e.intentSummary ?? '' }];
			state.queuedIntents.set(e.personaId, updated);
			return { personaId: e.personaId, updated };
		});
	await Promise.all(
		updates.map(({ personaId, updated }) =>
			db()
				.doc(`topics/${topicId}/sessions/0/engagements/${personaId}`)
				.set({ pendingIntents: updated }, { merge: true })
		)
	);
};

export const consumeQueuedIntent = async ({
	topicId,
	state,
	personaId,
	queuedEntries
}: {
	topicId: string;
	state: DebateState;
	personaId: string;
	queuedEntries: QueuedIntent[] | undefined;
}): Promise<void> => {
	if (!queuedEntries || queuedEntries.length === 0) return;
	const remaining = queuedEntries.slice(1);
	if (remaining.length === 0) {
		state.queuedIntents.delete(personaId);
	} else {
		state.queuedIntents.set(personaId, remaining);
	}
	await db()
		.doc(`topics/${topicId}/sessions/0/engagements/${personaId}`)
		.set({ pendingIntents: [...remaining] }, { merge: true });
};

export const loadQueuedIntents = async (topicId: string): Promise<Map<string, QueuedIntent[]>> => {
	const snap = await db().collection(`topics/${topicId}/sessions/0/engagements`).get();
	const result = new Map<string, QueuedIntent[]>();
	for (const docSnap of snap.docs) {
		const data = docSnap.data() as { pendingIntents?: QueuedIntent[] };
		result.set(docSnap.id, data.pendingIntents ?? []);
	}
	return result;
};
