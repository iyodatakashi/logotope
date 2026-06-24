import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { generatePostDebateComment } from '../../agents/persona-agent.js';
import { getLatestBelief } from './belief.js';
import type { DebateState } from '../../types/debate.types.js';
import type { Persona } from '../../types/persona.types.js';

const db = () => getFirestore();

/**
 * 各ペルソナの最終信念を基に事後コメントを生成して postDebateComments/0 に保存し、
 * phaseStatus を running のときだけ generated へ遷移する（冪等）。既に generated なら no-op。
 * generated 遷移は討論ループ終了後の終端フェーズを表し、コメント生成と不可分なため本モジュールが所有する。
 */
export const persistPostDebateComments = async ({
	topicId,
	personas,
	state
}: {
	topicId: string;
	personas: Persona[];
	state: DebateState;
}): Promise<void> => {
	const comments: Array<{ id: string; personaId: string; content: string; sortOrder: number }> = [];
	for (let i = 0; i < personas.length; i++) {
		const persona = personas[i];
		const finalBelief = getLatestBelief(persona).content;
		const commentResult = await generatePostDebateComment(
			persona,
			finalBelief,
			state.turns,
			personas
		);
		if (commentResult.ok) {
			const id = nanoid();
			comments.push({
				id,
				personaId: persona.id,
				content: commentResult.value.content,
				sortOrder: i
			});
		}
	}

	await db().doc(`topics/${topicId}/postDebateComments/0`).set({ comments });

	const ref = db().doc(`topics/${topicId}`);
	await db().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (!snap.exists) return;
		const data = snap.data() as { phaseStatus?: string };
		if (data.phaseStatus !== 'running') return;
		tx.update(ref, { phaseStatus: 'generated', updatedAt: Timestamp.now() });
	});
};

/** 事後コメントを空にリセットする（restart 時の後始末） */
export const clearPostDebateComments = async (topicId: string): Promise<void> => {
	await db().doc(`topics/${topicId}/postDebateComments/0`).set({ comments: [] });
};
