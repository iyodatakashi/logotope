import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { requireAuth } from '../utils/auth.js';
import { runInterview as runInterviewAgent } from '../agents/interview-agent.js';
import { getTopicContext } from '../pipeline/topics/topic-context.js';
import { getPersonaById } from '../pipeline/personas/personas.js';
import { confirmInterviewsGeneratedIfAllComplete } from '../pipeline/interviews/interview-completion.js';
import type { Persona, InterviewForFirestore } from '../types/persona.types.js';

const db = () => getFirestore();

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY'];

/**
 * 単一ペルソナの取材本体（HTTP 非依存）。初期チェーンの取材ステップと再取材 onCall が共有する。
 * 取材実行 → 当該ペルソナへ結果永続（completed / error）→ 全件完了なら generated 確定、までを担う。
 * 事実基盤を含む共有コンテキストはサーバ権威の getTopicContext で供給する（FE からは渡さない・R9.3）。
 * 失敗時は当該ペルソナを error で永続してから throw する（呼び出し側の失敗集約・Cloud Tasks リトライに委ねる）。
 */
export const runInterviewCore = async (
	topicId: string,
	personaId: string,
	topicTitle: string,
	persona: Persona
): Promise<void> => {
	const personaRef = db().doc(`topics/${topicId}/personas/${personaId}`);
	// 取材開始をサーバ側で即時に反映する（UI が「取材中」を表示できるよう status を先に立てる）。
	// 初期チェーンの取材段は FE を介さず直接呼ぶため、ここで in_progress を書かないと待機中に張り付く。
	await personaRef.update({ interview: { status: 'in_progress' } });
	const topicContext = await getTopicContext(topicId);
	const result = await runInterviewAgent(topicTitle, persona, topicContext);
	if (!result.ok) {
		console.error('[runInterview] error', result.error);
		const message = 'message' in result.error ? result.error.message : result.error.code;
		// 当該ペルソナを error 状態で永続化してから throw する。FE は onSnapshot で error を反映し、
		// 全件完了判定は error が残る間 generated に到達しない（再取材で running 復帰後に確定）。
		await personaRef.update({ interview: { status: 'error', errorMessage: message } });
		throw new Error(message);
	}

	// 取材結果はサーバが当該ペルソナ文書へ永続化する（結果の Single Source of Truth は Firestore）。
	// 書き込みは永続形 InterviewForFirestore で型付けする（オブジェクトリテラル直書きを解消）。
	const interview: InterviewForFirestore = {
		draftBelief: result.value.draftBelief,
		verificationReport: result.value.verificationReport,
		interviewRecord: result.value.interviewRecord,
		sources: result.value.sources,
		status: 'completed',
		completedAt: Timestamp.now()
	};
	await personaRef.update({
		interview,
		beliefs: [{ version: 0, content: result.value.belief, createdAt: Timestamp.now() }]
	});
	// 自ペルソナの completed 永続化後に全件完了をサーバ側で判定し、全件完了なら generated を確定する。
	await confirmInterviewsGeneratedIfAllComplete(topicId);
};

export const runInterview = onCall({ timeoutSeconds: 300, secrets: SECRETS }, async (request) => {
	requireAuth(request);
	const { topicId, personaId, topicTitle } = request.data as {
		topicId: string;
		personaId: string;
		topicTitle: string;
	};
	if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');
	if (!personaId?.trim()) throw new HttpsError('invalid-argument', 'personaId is required');
	if (!topicTitle?.trim()) throw new HttpsError('invalid-argument', 'topicTitle is required');

	// ペルソナは FE から受け取らず、サーバが id で Firestore から読む（自データの Single Source of Truth はサーバ）。
	const persona = await getPersonaById(topicId, personaId);
	if (!persona) throw new HttpsError('not-found', 'Persona not found');

	try {
		await runInterviewCore(topicId, personaId, topicTitle, persona);
	} catch (err) {
		throw err instanceof HttpsError
			? err
			: new HttpsError('internal', err instanceof Error ? err.message : String(err));
	}
	return {};
});
