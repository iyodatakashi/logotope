import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { requireAuth } from '../utils/auth.js';
import { advancePersonaChain } from '../pipeline/personas/persona-chain.js';
import { enqueuePersonaStep } from '../pipeline/personas/enqueue-persona-step.js';
import { setTopicPhaseStatus } from '../utils/topic-phase.js';
import { discardStakeholders, discardPersonas } from '../pipeline/personas/personas.js';
import { discardChaptersWithAnalysis } from '../pipeline/chapters/chapter-discard.js';
import { resetDebate } from '../pipeline/debate/debate-lifecycle.js';
import { clearEditedArtifact } from '../pipeline/editing/edited-repository.js';
import type { PersonaStepPayload } from '../pipeline/personas/enqueue-persona-step.js';

// ペルソナ生成の一気通貫 API。討論・編集と同型の「起動 onCall ＋単一 onTaskDispatched チェーン」。
// ステークホルダー生成〜ペルソナ生成〜全ペルソナ取材をサーバ側で完結させる（クライアント在席非依存）。

const db = () => getFirestore();
const REGION = 'asia-northeast1';
const MAX_ATTEMPTS = 3;
const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'TAVILY_API_KEY'];

/**
 * ペルソナ再生成をサーバ権威で所有する。単一操作で「personas を running に確定＋新世代 runId（手順1・
 * 単一 update・原子的）→ 自層＋下流破棄（手順2）→ 最初の stakeholders ステップ投入（手順3）」をこの順序で
 * 実行する。手順1を先に置くことで approved（下流）起点の再生成でも下流が完了表示にならず、新 runId により
 * 旧世代の残タスクを無効化して中間の窓を作らない（R3.1, 3.3, 3.5）。初回生成は破棄が no-op で同一経路を通る。
 * 手順1後の失敗は personas/stopped に留め、下流 approved へ戻さない（R3.4）。破棄はクライアント側 reset 群
 * （stakeholders/personas/chapters/debate/editing）と同順・同範囲。
 */
export const startPersonaGeneration = onCall({ timeoutSeconds: 60 }, async (request) => {
	requireAuth(request);
	const { topicId } = request.data as { topicId: string };
	if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');

	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) throw new HttpsError('not-found', 'Topic not found');

	// 手順1: personas を running に確定＋新世代 runId（単一 update・原子的）。
	const runId = nanoid();
	await db()
		.doc(`topics/${topicId}`)
		.update({ phase: 'personas', phaseStatus: 'running', runId, updatedAt: Timestamp.now() });

	try {
		// 手順2: 自層＋下流を破棄（初回生成は no-op）。
		await discardStakeholders(topicId);
		await discardPersonas(topicId);
		await discardChaptersWithAnalysis(topicId);
		await resetDebate(topicId);
		await clearEditedArtifact(topicId);

		// 手順3: 最初の stakeholders ステップを1件 enqueue（新 runId に紐づく）。
		await enqueuePersonaStep({ topicId, runId, stepKind: 'stakeholders' });

		return { topicId };
	} catch (err) {
		// 手順1後の失敗は対象フェーズのまま停止（下流 approved へ戻さない・R3.4）。
		console.error('[startPersonaGeneration] error', { topicId }, err);
		await setTopicPhaseStatus(topicId, 'personas', 'stopped');
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
