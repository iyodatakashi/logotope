import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { requireAuth } from '../utils/auth.js';
import { generatePersonas as runPersonaGeneration } from '../agents/persona-generator-agent.js';
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
			return await runPersonaGeneration(title, stakeholders, topicId);
		} catch (err) {
			console.error('[generatePersonas] error', { topicId, title }, err);
			throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
		}
	}
);
