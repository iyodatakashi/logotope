import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { requireAuth } from '../utils/auth.js';
import { runInterview as runInterviewAgent } from '../agents/interview-agent.js';
import { getTopicContext } from '../pipeline/topics/topic-context.js';
import { confirmInterviewsGeneratedIfAllComplete } from '../pipeline/interviews/interview-completion.js';
import type { Persona } from '../types/persona.types.js';

const db = () => getFirestore();

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'];

export const runInterview = onCall({ timeoutSeconds: 300, secrets: SECRETS }, async (request) => {
	requireAuth(request);
	const { topicId, personaId, topicTitle, persona } = request.data as {
		topicId: string;
		personaId: string;
		topicTitle: string;
		persona: Persona;
	};
	if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');
	if (!personaId?.trim()) throw new HttpsError('invalid-argument', 'personaId is required');
	if (!topicTitle?.trim()) throw new HttpsError('invalid-argument', 'topicTitle is required');
	if (!persona?.name) throw new HttpsError('invalid-argument', 'persona is required');

	const personaRef = db().doc(`topics/${topicId}/personas/${personaId}`);
	// 共有コンテキスト（事実基盤を含む）はサーバ権威の getTopicContext で供給する。
	// FE からは factBase を渡さない（stale 排除・R9.3）。
	const topicContext = await getTopicContext(topicId);
	const result = await runInterviewAgent(topicTitle, persona, topicContext);
	if (!result.ok) {
		console.error('[runInterview] error', result.error);
		const message = 'message' in result.error ? result.error.message : result.error.code;
		// 当該ペルソナを error 状態で永続化してから throw する。FE は onSnapshot で error を反映し、
		// 全件完了判定は error が残る間 generated に到達しない（再取材で running 復帰後に確定）。
		await personaRef.update({ interview: { status: 'error', errorMessage: message } });
		throw new HttpsError('internal', message);
	}

	// 取材結果はサーバが当該ペルソナ文書へ永続化する（結果の Single Source of Truth は Firestore）。
	await personaRef.update({
		interview: {
			draftBelief: result.value.draftBelief,
			verificationReport: result.value.verificationReport,
			interviewRecord: result.value.interviewRecord,
			sources: result.value.sources,
			status: 'completed',
			completedAt: Timestamp.now()
		},
		beliefs: [{ version: 0, content: result.value.belief, createdAt: Timestamp.now() }]
	});
	// 自ペルソナの completed 永続化後に全件完了をサーバ側で判定し、全件完了なら generated を確定する。
	await confirmInterviewsGeneratedIfAllComplete(topicId);
	return {};
});
