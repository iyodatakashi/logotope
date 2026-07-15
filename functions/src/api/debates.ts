import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getTopicById } from '../pipeline/topics/topics.js';
import { getChaptersByTopicId } from '../pipeline/debate/chapter.js';
import { advanceDebate } from '../pipeline/debate/debate-orchestrator.js';
import { enqueueStep, taskKey } from '../pipeline/debate/enqueue-step.js';
import {
	beginDebateRun,
	restartDebateFromChapter,
	resetDebate as resetDebateLifecycle
} from '../pipeline/debate/debate-lifecycle.js';
import { requireAuth } from '../utils/auth.js';
import type { StepPayload } from '../types/step.types.js';

const REGION = 'asia-northeast1';

/** 討論の起点（最初の章開始ステップ）を deterministic id で投入する */
const enqueueFirstOpenStep = async (
	topicId: string,
	chapterIndex: number,
	chapterId: string,
	runId: string,
	singleChapterMode?: boolean
): Promise<void> => {
	const payload: StepPayload = {
		topicId,
		chapterIndex,
		runId,
		stepKind: 'open',
		expectedTurnIndex: 0,
		singleChapterMode
	};
	await enqueueStep(payload, taskKey({ runId, chapterId, frontierIndex: 0 }));
};

/**
 * 討論再生成をサーバ権威で所有する。単一操作で「debate を running に確定＋新世代 runId（手順1）→ 討論付随
 * データ（turns/engagements/awareness）＋下流 editing 破棄（手順2・resetDebate が担う）→ 討論開始（手順3・
 * 最初の open ステップ投入）」をこの順序で実行する。手順1を先に置き新 runId を発行することで、approved 起点の
 * 再生成でも下流（editing）が完了表示にならず、旧世代の残タスクを無効化する（R3.1, 3.3, 3.5）。初回開始は破棄が
 * no-op で同一経路を通る。手順1後の失敗は debate/stopped に留め、下流 approved へ戻さない（R3.4）。
 */
export const startDebate = onCall({ timeoutSeconds: 60 }, async (request) => {
	requireAuth(request);
	const { topicId, singleChapterMode } = request.data as {
		topicId: string;
		singleChapterMode?: boolean;
	};

	try {
		const topic = await getTopicById(topicId);
		if (!topic) throw new HttpsError('not-found', 'Topic not found');

		const chapters = await getChaptersByTopicId(topicId);
		const firstChapter = chapters[0];
		if (!firstChapter) throw new HttpsError('not-found', 'No chapter to start');

		// 手順1: debate を running に確定＋新世代 runId（旧世代タスクは世代不一致で自己停止）。
		const runId = await beginDebateRun(topicId, 'running');

		try {
			// 手順2: 討論付随データ＋下流 editing 破棄（resetDebate が turns/engagements/awareness＋編集成果物を破棄）。
			await resetDebateLifecycle(topicId);
			// 手順3: 討論開始（最初の open ステップを新 runId で投入）。
			await enqueueFirstOpenStep(topicId, 0, firstChapter.id, runId, singleChapterMode);
		} catch (err) {
			// 手順1後の失敗は対象フェーズのまま停止（下流 approved へ戻さない・R3.4）。
			await beginDebateRun(topicId, 'stopped');
			throw err;
		}

		return { topicId };
	} catch (err) {
		console.error('[startDebate] error', { topicId }, err);
		throw err instanceof HttpsError
			? err
			: new HttpsError('internal', err instanceof Error ? err.message : String(err));
	}
});

export const restartDebate = onCall({ timeoutSeconds: 60 }, async (request) => {
	requireAuth(request);
	const { topicId, singleChapterMode } = request.data as {
		topicId: string;
		singleChapterMode?: boolean;
	};

	try {
		const topic = await getTopicById(topicId);
		if (!topic) throw new HttpsError('not-found', 'Topic not found');

		const chapters = await getChaptersByTopicId(topicId);
		const runningChapter = chapters.find((chapter) => chapter.status === 'running');
		const resumeChapter =
			runningChapter ?? chapters.find((chapter) => chapter.status === 'pending');
		if (!resumeChapter) throw new HttpsError('not-found', 'No chapter to restart');

		const runId = await restartDebateFromChapter(topicId, resumeChapter.id);
		await enqueueFirstOpenStep(
			topicId,
			resumeChapter.chapterIndex,
			resumeChapter.id,
			runId,
			singleChapterMode
		);

		return { topicId };
	} catch (err) {
		console.error('[restartDebate] error', { topicId }, err);
		throw err instanceof HttpsError
			? err
			: new HttpsError('internal', err instanceof Error ? err.message : String(err));
	}
});

/**
 * 討論を全章リセットする（付随データも全削除）。running にはしない。
 * 章付随データの削除責務をサーバへ集約するため、FE は本エンドポイントを呼ぶだけにする。
 */
export const resetDebate = onCall({ timeoutSeconds: 60 }, async (request) => {
	requireAuth(request);
	const { topicId } = request.data as { topicId: string };
	if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');

	try {
		const topic = await getTopicById(topicId);
		if (!topic) throw new HttpsError('not-found', 'Topic not found');

		await resetDebateLifecycle(topicId);
		return { topicId };
	} catch (err) {
		console.error('[resetDebate] error', { topicId }, err);
		throw err instanceof HttpsError
			? err
			: new HttpsError('internal', err instanceof Error ? err.message : String(err));
	}
});

const MAX_ATTEMPTS = 3;

export const runStep = onTaskDispatched(
	{
		timeoutSeconds: 540,
		region: REGION,
		secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'TAVILY_API_KEY'],
		retryConfig: { maxAttempts: MAX_ATTEMPTS, minBackoffSeconds: 30 },
		rateLimits: { maxConcurrentDispatches: 5 }
	},
	async (req) => {
		const payload = req.data as StepPayload;
		try {
			await advanceDebate(payload);
		} catch (err) {
			console.error(
				'[runStep] error',
				{
					topicId: payload.topicId,
					chapterIndex: payload.chapterIndex,
					stepKind: payload.stepKind,
					expectedTurnIndex: payload.expectedTurnIndex,
					retryCount: req.retryCount
				},
				err
			);
			if ((req.retryCount ?? 0) >= MAX_ATTEMPTS - 1) {
				await beginDebateRun(payload.topicId, 'stopped');
			}
			throw err;
		}
	}
);
