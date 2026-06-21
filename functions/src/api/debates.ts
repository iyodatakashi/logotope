import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';
import { getTopicById } from '../pipeline/topics/topics.js';
import { getChaptersByTopicId } from '../pipeline/debate/debate-lifecycle.js';
import { executeChapterTask, DEFAULT_OPTIONS } from '../pipeline/debate/debate-orchestrator.js';
import {
	activateDebate,
	markDebateStopped,
	restartChapter
} from '../pipeline/debate/debate-lifecycle.js';
import { requireAuth } from '../utils/auth.js';

const REGION = 'asia-northeast1';

const enqueueChapterTask = async (
	topicId: string,
	chapterIndex: number,
	runId: string,
	singleChapterMode?: boolean
): Promise<void> => {
	const queue = getFunctions().taskQueue(`locations/${REGION}/functions/runChapter`);
	await queue.enqueue(
		{ topicId, chapterIndex, runId, singleChapterMode },
		{ scheduleDelaySeconds: 0 }
	);
};

export const startDebate = onCall({ timeoutSeconds: 60 }, async (request) => {
	requireAuth(request);
	const { topicId, singleChapterMode } = request.data as {
		topicId: string;
		singleChapterMode?: boolean;
	};

	try {
		const topic = await getTopicById(topicId);
		if (!topic) throw new HttpsError('not-found', 'Topic not found');

		const runId = await activateDebate(topicId);
		await enqueueChapterTask(topicId, 0, runId, singleChapterMode);

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
		const runningChapter = chapters.find((c) => c.status === 'running');
		const resumeChapter = runningChapter ?? chapters.find((c) => c.status === 'pending');
		if (!resumeChapter) throw new HttpsError('not-found', 'No chapter to restart');

		const runId = await restartChapter(topicId, resumeChapter.id);
		await enqueueChapterTask(topicId, resumeChapter.chapterIndex, runId, singleChapterMode);

		return { topicId };
	} catch (err) {
		console.error('[restartDebate] error', { topicId }, err);
		throw err instanceof HttpsError
			? err
			: new HttpsError('internal', err instanceof Error ? err.message : String(err));
	}
});

const MAX_ATTEMPTS = 3;

export const runChapter = onTaskDispatched(
	{
		timeoutSeconds: 540,
		region: REGION,
		secrets: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'],
		retryConfig: { maxAttempts: MAX_ATTEMPTS, minBackoffSeconds: 30 },
		rateLimits: { maxConcurrentDispatches: 5 }
	},
	async (req) => {
		const { topicId, chapterIndex, runId, singleChapterMode } = req.data as {
			topicId: string;
			chapterIndex: number;
			runId?: string;
			singleChapterMode?: boolean;
		};
		try {
			const hasNextChapter = await executeChapterTask(
				topicId,
				chapterIndex,
				{ ...DEFAULT_OPTIONS, singleChapterMode },
				runId
			);
			if (hasNextChapter) {
				await enqueueChapterTask(topicId, chapterIndex + 1, runId ?? '', singleChapterMode);
			}
		} catch (err) {
			console.error(
				'[runChapter] error',
				{ topicId, chapterIndex, retryCount: req.retryCount },
				err
			);
			if ((req.retryCount ?? 0) >= MAX_ATTEMPTS - 1) {
				await markDebateStopped(topicId);
			}
			throw err;
		}
	}
);
