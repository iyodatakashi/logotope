import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { requireAuth } from '../utils/auth.js';
import { advancePersonaChain } from '../pipeline/personas/persona-chain.js';
import { enqueuePersonaStep } from '../pipeline/personas/enqueue-persona-step.js';
import { setTopicPhaseStatus } from '../utils/topic-phase.js';
import type { PersonaStepPayload } from '../pipeline/personas/enqueue-persona-step.js';

// ペルソナ生成の一気通貫 API。討論・編集と同型の「起動 onCall ＋単一 onTaskDispatched チェーン」。
// ステークホルダー生成〜ペルソナ生成〜全ペルソナ取材をサーバ側で完結させる（クライアント在席非依存）。

const db = () => getFirestore();
const REGION = 'asia-northeast1';
const MAX_ATTEMPTS = 3;
const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'TAVILY_API_KEY'];

/**
 * 一気通貫を起動する。personas フェーズを running にし新しい世代 runId を発行、最初の
 * stakeholders ステップを1件 enqueue して即返す短時間 onCall（在席非依存・R2.1, 2.2, 2.5）。
 * 再生成時は FE 側で下流破棄（reset）を済ませてから呼ぶ。新 runId で旧タスク id 衝突を回避する。
 */
export const startPersonaGeneration = onCall({ timeoutSeconds: 60 }, async (request) => {
	requireAuth(request);
	const { topicId } = request.data as { topicId: string };
	if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');

	try {
		const snap = await db().doc(`topics/${topicId}`).get();
		if (!snap.exists) throw new HttpsError('not-found', 'Topic not found');

		const runId = nanoid();
		await db()
			.doc(`topics/${topicId}`)
			.update({ phase: 'personas', phaseStatus: 'running', runId, updatedAt: Timestamp.now() });
		await enqueuePersonaStep({ topicId, runId, stepKind: 'stakeholders' });

		return { topicId };
	} catch (err) {
		console.error('[startPersonaGeneration] error', { topicId }, err);
		throw err instanceof HttpsError
			? err
			: new HttpsError('internal', err instanceof Error ? err.message : String(err));
	}
});

/**
 * ペルソナ生成ステップをタスクとして実行する。段の判別・生成物永続・次段 enqueue は
 * advancePersonaChain が担う。例外は Cloud Tasks のリトライに委ね、終端失敗（最終試行）で
 * personas フェーズを停止（stopped）にする（R5.1）。
 */
export const runPersonaStep = onTaskDispatched(
	{
		timeoutSeconds: 540,
		region: REGION,
		secrets: SECRETS,
		retryConfig: { maxAttempts: MAX_ATTEMPTS, minBackoffSeconds: 30 },
		rateLimits: { maxConcurrentDispatches: 5 }
	},
	async (req) => {
		const payload = req.data as PersonaStepPayload;
		try {
			await advancePersonaChain(payload);
		} catch (err) {
			console.error(
				'[runPersonaStep] error',
				{
					topicId: payload.topicId,
					stepKind: payload.stepKind,
					personaId: payload.personaId,
					retryCount: req.retryCount
				},
				err
			);
			if ((req.retryCount ?? 0) >= MAX_ATTEMPTS - 1) {
				await setTopicPhaseStatus(payload.topicId, 'personas', 'stopped');
			}
			throw err;
		}
	}
);
