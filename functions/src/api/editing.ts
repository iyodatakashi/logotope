import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getTopicById } from '../pipeline/topics/topics.js';
import { getChaptersByTopicId } from '../pipeline/debate/chapter.js';
import { advanceEditing } from '../pipeline/editing/editing-orchestrator.js';
import { enqueueEditingStep } from '../pipeline/editing/enqueue-editing-step.js';
import {
	startEditingRun,
	resetEditingRun,
	stopEditingRun
} from '../pipeline/editing/editing-lifecycle.js';
import { isDebateCompleted } from '../pipeline/debate/debate-lifecycle.js';
import { requireAuth } from '../utils/auth.js';
import type { EditingStepPayload } from '../pipeline/editing/enqueue-editing-step.js';

// 編集フェーズ（Phase 6）の API。討論とライフサイクルが異なるため専用の onCall / onTaskDispatched を新設する。
// 編集は討論完了時に自動実行せず、管理者が startEditing を明示的に呼んだときのみ起動する（Req 1.4）。

const REGION = 'asia-northeast1';
const MAX_ATTEMPTS = 3;

/**
 * 編集を開始する。既存の編集成果物を破棄して phase6/running・新 runId にし、最初の章編集ステップを投入する。
 * 再実行時も同じ経路（startEditingRun で旧成果物を即時破棄）を通る（Req 1.3, 1.6, 1.7, 5.5）。
 */
export const startEditing = onCall({ timeoutSeconds: 60 }, async (request) => {
	requireAuth(request);
	const { topicId } = request.data as { topicId: string };
	if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');

	try {
		const topic = await getTopicById(topicId);
		if (!topic) throw new HttpsError('not-found', 'Topic not found');

		// 討論完了ゲート（Req 5.4）。討論フェーズが generated 到達済みでなければ編集を起動しない。
		// 章存在チェックは章立て段階で満たされるため討論完了の判定には使わない。
		if (!(await isDebateCompleted(topicId))) {
			throw new HttpsError('failed-precondition', 'Debate is not completed');
		}

		const chapters = await getChaptersByTopicId(topicId);
		if (!chapters.length) throw new HttpsError('not-found', 'No chapter to edit');

		const runId = await startEditingRun(topicId);
		await enqueueEditingStep({ topicId, runId, stepKind: 'chapter', chapterIndex: 0 });

		return { topicId };
	} catch (err) {
		console.error('[startEditing] error', { topicId }, err);
		throw err instanceof HttpsError
			? err
			: new HttpsError('internal', err instanceof Error ? err.message : String(err));
	}
});

/** 編集を未実行状態へ戻す。編集成果物を破棄し、編集フェーズを not_started にする（原本は不変） */
export const resetEditing = onCall({ timeoutSeconds: 60 }, async (request) => {
	requireAuth(request);
	const { topicId } = request.data as { topicId: string };
	if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');

	try {
		const topic = await getTopicById(topicId);
		if (!topic) throw new HttpsError('not-found', 'Topic not found');

		await resetEditingRun(topicId);
		return { topicId };
	} catch (err) {
		console.error('[resetEditing] error', { topicId }, err);
		throw err instanceof HttpsError
			? err
			: new HttpsError('internal', err instanceof Error ? err.message : String(err));
	}
});

/**
 * 編集ステップをタスクとして実行する。LLM 用シークレットを付与し、例外は Cloud Tasks のリトライに委ねる。
 * 終端失敗（最終試行）で編集フェーズを停止（stopped）にし、再実行できるようにする（Req 6.4）。
 */
export const runEditingStep = onTaskDispatched(
	{
		timeoutSeconds: 540,
		region: REGION,
		secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'],
		retryConfig: { maxAttempts: MAX_ATTEMPTS, minBackoffSeconds: 30 },
		rateLimits: { maxConcurrentDispatches: 5 }
	},
	async (req) => {
		const payload = req.data as EditingStepPayload;
		try {
			await advanceEditing(payload);
		} catch (err) {
			console.error(
				'[runEditingStep] error',
				{
					topicId: payload.topicId,
					stepKind: payload.stepKind,
					chapterIndex: payload.chapterIndex,
					retryCount: req.retryCount
				},
				err
			);
			if ((req.retryCount ?? 0) >= MAX_ATTEMPTS - 1) {
				await stopEditingRun(payload.topicId, payload.runId);
			}
			throw err;
		}
	}
);
