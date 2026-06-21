import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAuth } from '../utils/auth.js';
import { planChapters } from '../pipeline/chapters/chapter-generator.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

export const generateChapters = onCall(
	{ timeoutSeconds: 120, secrets: SECRETS },
	async (request) => {
		requireAuth(request);
		const { topicId } = request.data as { topicId: string };
		if (!topicId) throw new HttpsError('invalid-argument', 'topicId is required');

		try {
			await planChapters(topicId);
		} catch (err) {
			throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
		}

		return { topicId };
	}
);
