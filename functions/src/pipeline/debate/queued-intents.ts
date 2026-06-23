import { getFirestore } from 'firebase-admin/firestore';
import { shouldQueue } from './speaker-selection.js';
import { INTENT_EXPIRY_TURNS } from '../../constants/debate.constants.js';
import type {
	DebateState,
	QueuedIntent,
	SpeakerSelection,
	Engagement
} from '../../types/debate.types.js';

const db = () => getFirestore();

/**
 * 失効した発言意図キューを state と Firestore の両方から取り除く。
 * INTENT_EXPIRY_TURNS ターンより古い（またはトリガーターンが消えた）エントリを破棄し、
 * 変化があったペルソナの分だけ Firestore に書き戻す（全消えはローカル削除のみ）。
 */
export const expireQueuedIntents = async ({
	topicId,
	chapterId,
	state
}: {
	topicId: string;
	chapterId: string;
	state: DebateState;
}): Promise<void> => {
	const writes: Array<{ personaId: string; alive: QueuedIntent[] }> = [];
	for (const [personaId, items] of state.queuedIntents.entries()) {
		const alive = items.filter((item) => {
			const triggerIdx = state.turns.findIndex((t) => t.id === item.triggerTurnId);
			if (triggerIdx === -1) return false;
			return state.turns.length - triggerIdx <= INTENT_EXPIRY_TURNS;
		});
		if (alive.length === items.length) continue; // 失効なし → 書き込み不要
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
				.doc(`topics/${topicId}/chapters/${chapterId}/engagements/${personaId}`)
				.set({ queuedIntents: alive }, { merge: true })
		)
	);
};

/** 高意欲かつ非選択ペルソナのインテントをキューに追加し Firestore に write-through する */
export const addQueuedIntents = async ({
	topicId,
	chapterId,
	state,
	engagements,
	speakerSelection,
	triggerTurnId
}: {
	topicId: string;
	chapterId: string;
	state: DebateState;
	engagements: readonly Engagement[];
	speakerSelection: SpeakerSelection;
	triggerTurnId: string;
}): Promise<void> => {
	// 今回の話者本人は除外（これから発言するので積む必要がない）。閾値超えの意欲者だけをキューに積む
	const updates = engagements
		.filter((e) => shouldQueue(e) && e.personaId !== speakerSelection.personaId)
		.map((e) => {
			const existing = state.queuedIntents.get(e.personaId) ?? [];
			const updated = [...existing, { triggerTurnId, intentSummary: e.intentSummary ?? '' }];
			state.queuedIntents.set(e.personaId, updated);
			return { personaId: e.personaId, updated };
		});
	await Promise.all(
		updates.map(({ personaId, updated }) =>
			db()
				.doc(`topics/${topicId}/chapters/${chapterId}/engagements/${personaId}`)
				.set({ queuedIntents: updated }, { merge: true })
		)
	);
};

/** キュー保持者が発言したら、消化した先頭1件を取り除いて残りを state と Firestore に反映する */
export const consumeQueuedIntent = async ({
	topicId,
	chapterId,
	state,
	personaId,
	queuedEntries
}: {
	topicId: string;
	chapterId: string;
	state: DebateState;
	personaId: string;
	queuedEntries: QueuedIntent[] | undefined;
}): Promise<void> => {
	if (!queuedEntries || queuedEntries.length === 0) return;
	const remaining = queuedEntries.slice(1); // 先頭（最古）の意図を消化済みとして落とす
	if (remaining.length === 0) {
		state.queuedIntents.delete(personaId);
	} else {
		state.queuedIntents.set(personaId, remaining);
	}
	await db()
		.doc(`topics/${topicId}/chapters/${chapterId}/engagements/${personaId}`)
		.set({ queuedIntents: [...remaining] }, { merge: true });
};

export const loadQueuedIntents = async (
	topicId: string,
	chapterId: string
): Promise<Map<string, QueuedIntent[]>> => {
	const snap = await db().collection(`topics/${topicId}/chapters/${chapterId}/engagements`).get();
	const result = new Map<string, QueuedIntent[]>();
	for (const docSnap of snap.docs) {
		const data = docSnap.data() as { queuedIntents?: QueuedIntent[] };
		if (data.queuedIntents && data.queuedIntents.length > 0) {
			result.set(docSnap.id, data.queuedIntents);
		}
	}
	return result;
};
