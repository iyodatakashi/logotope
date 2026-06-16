import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAuth } from '../utils/auth.js';
import { generateStakeholders as runStakeholderGeneration } from '../pipeline/stakeholders/stakeholder-generator.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

export const generateStakeholders = onCall(
	{ timeoutSeconds: 300, secrets: SECRETS },
	async (request) => {
		requireAuth(request);
		const { title } = request.data as { title: string };
		if (!title?.trim()) throw new HttpsError('invalid-argument', 'title is required');

		try {
			return await runStakeholderGeneration(title);
		} catch (err) {
			throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
		}
	}
);
