import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { requireAuth } from '../utils/auth.js';
import { generateStakeholders as runStakeholderGeneration } from '../agents/stakeholder-agent.js';
import { confirmPhaseGenerated } from '../utils/topic-phase.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

const db = () => getFirestore();

export const generateStakeholders = onCall(
	{ timeoutSeconds: 300, secrets: SECRETS },
	async (request) => {
		requireAuth(request);
		const { topicId, title } = request.data as { topicId: string; title: string };
		if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');
		if (!title?.trim()) throw new HttpsError('invalid-argument', 'title is required');

		try {
			const { stakeholders } = await runStakeholderGeneration(title);
			await db().doc(`topics/${topicId}/stakeholders/0`).set({ stakeholders });
			// 完了状態はサーバ権威で確定する。クライアントの生存（リロード・タブ閉じ）や
			// callable のタイムアウトに依存せず、running のときだけ generated へ冪等遷移させる。
			await confirmPhaseGenerated(topicId, 1);
			return {};
		} catch (err) {
			console.error('[generateStakeholders] error', { topicId, title }, err);
			throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
		}
	}
);
