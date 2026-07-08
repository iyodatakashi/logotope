import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAuth } from '../utils/auth.js';
import { planChapters } from '../pipeline/chapters/chapter-generator.js';
import { confirmPhaseGenerated } from '../utils/topic-phase.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'TAVILY_API_KEY'];

export const generateChapters = onCall(
	{ timeoutSeconds: 540, secrets: SECRETS },
	async (request) => {
		requireAuth(request);
		const { topicId } = request.data as { topicId: string };
		if (!topicId) throw new HttpsError('invalid-argument', 'topicId is required');

		try {
			await planChapters(topicId);
			// 章立て永続化の成功後、完了状態はサーバ権威で確定する。クライアントの生存や
			// callable のタイムアウトに依存せず、running のときだけ generated へ冪等遷移させる。
			await confirmPhaseGenerated(topicId, 'chapters');
		} catch (err) {
			console.error('[generateChapters] error', { topicId }, err);
			throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
		}

		return { topicId };
	}
);
