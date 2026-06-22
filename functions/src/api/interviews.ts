import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAuth } from '../utils/auth.js';
import { runInterview as runInterviewAgent } from '../agents/interview-agent.js';
import type { Persona } from '../types/persona.types.js';
import type { TopicContext } from '../types/topic.types.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'];

export const runInterview = onCall({ timeoutSeconds: 300, secrets: SECRETS }, async (request) => {
	requireAuth(request);
	const { topicTitle, persona, topicContext } = request.data as {
		topicTitle: string;
		persona: Persona;
		topicContext?: TopicContext;
	};
	if (!topicTitle?.trim()) throw new HttpsError('invalid-argument', 'topicTitle is required');
	if (!persona?.name) throw new HttpsError('invalid-argument', 'persona is required');

	const result = await runInterviewAgent(topicTitle, persona, topicContext);
	if (!result.ok) {
		console.error('[runInterview] error', result.error);
		const message = 'message' in result.error ? result.error.message : result.error.code;
		throw new HttpsError('internal', message);
	}
	return result.value;
});
