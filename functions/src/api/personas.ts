import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { requireAuth } from '../utils/auth.js';
import { generatePersonas as runPersonaGeneration } from '../agents/persona-generator-agent.js';
import { getTopicContext } from '../pipeline/topics/topic-context.js';
import { confirmPhaseGenerated } from '../utils/topic-phase.js';
import type { Stakeholder } from '../types/stakeholder.types.js';

const db = () => getFirestore();

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

export const generatePersonas = onCall(
	{ timeoutSeconds: 300, secrets: SECRETS },
	async (request) => {
		requireAuth(request);
		const { topicId, title } = request.data as { topicId: string; title: string };
		if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');
		if (!title?.trim()) throw new HttpsError('invalid-argument', 'title is required');

		const snap = await db().doc(`topics/${topicId}/stakeholders/0`).get();
		if (!snap.exists) throw new HttpsError('invalid-argument', 'stakeholders not found');
		const stakeholders = (snap.data() as { stakeholders: Stakeholder[] }).stakeholders;

		try {
			const topicContext = await getTopicContext(topicId);
			const { personas } = await runPersonaGeneration(title, stakeholders, topicId, topicContext);
			// 全ペルソナ文書を一括（batch）で永続化する。途中失敗では未コミット（全件 or 未書込）と
			// なり、不完全な成果物を残さない。結果の Single Source of Truth は Firestore。
			const batch = db().batch();
			personas.forEach((persona, index) => {
				const { id, ...rest } = persona;
				batch.set(db().doc(`topics/${topicId}/personas/${id}`), {
					...rest,
					sortOrder: index,
					approved: false,
					beliefs: [],
					createdAt: Timestamp.now()
				});
			});
			await batch.commit();
			// 永続化成功後、完了状態はサーバ権威で確定する。クライアントの生存や callable の
			// タイムアウトに依存せず、running のときだけ generated へ冪等遷移させる。
			await confirmPhaseGenerated(topicId, 'personas');
			return {};
		} catch (err) {
			console.error('[generatePersonas] error', { topicId, title }, err);
			throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
		}
	}
);
