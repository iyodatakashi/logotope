import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { requireAuth } from '../utils/auth.js';
import { InterviewRunnerService } from '../pipeline/interview-runner.js';
import type { PersonaInput } from '../types/interviews.types.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

export const runInterview = onCall({ timeoutSeconds: 300, secrets: SECRETS }, async (request) => {
	requireAuth(request);
	const { topicTitle, persona } = request.data as { topicTitle: string; persona: PersonaInput };
	if (!topicTitle?.trim()) throw new HttpsError('invalid-argument', 'topicTitle is required');
	if (!persona?.name) throw new HttpsError('invalid-argument', 'persona is required');

	try {
		return await new InterviewRunnerService().runInterview(topicTitle, persona);
	} catch (err) {
		throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
	}
});
