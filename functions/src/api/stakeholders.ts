import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { requireAuth } from '../utils/auth.js';
import { generateStakeholders as runStakeholderGeneration } from '../agents/stakeholder-agent.js';
import { getTopicContext } from '../pipeline/topics/topic-context.js';
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

		const topicContext = await getTopicContext(topicId);
		const result = await runStakeholderGeneration(title, topicContext);
		if (!result.ok) {
			const message = 'message' in result.error ? result.error.message : result.error.code;
			console.error('[generateStakeholders] error', { topicId, title }, result.error);
			throw new HttpsError('internal', message);
		}

		await db()
			.doc(`topics/${topicId}/stakeholders/0`)
			.set({ stakeholders: result.value.stakeholders });
		// 完了状態はサーバ権威で確定する。クライアントの生存（リロード・タブ閉じ）や
		// callable のタイムアウトに依存せず、running のときだけ generated へ冪等遷移させる。
		await confirmPhaseGenerated(topicId, 'stakeholders');
		return {};
	}
);
