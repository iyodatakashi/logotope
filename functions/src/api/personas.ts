import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAuth } from '../utils/auth.js';
import { generatePersonas as runPersonaGeneration } from '../pipeline/personas/persona-generator.js';
import type { Stakeholder } from '../types/stakeholder.types.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

export const generatePersonas = onCall(
	{ timeoutSeconds: 300, secrets: SECRETS },
	async (request) => {
		requireAuth(request);
		const { title, stakeholders } = request.data as { title: string; stakeholders: Stakeholder[] };
		if (!title?.trim()) throw new HttpsError('invalid-argument', 'title is required');
		if (!stakeholders?.length) throw new HttpsError('invalid-argument', 'stakeholders is required');

		try {
			return await runPersonaGeneration(title, stakeholders);
		} catch (err) {
			throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
		}
	}
);
