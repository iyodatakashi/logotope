import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFunctions } from 'firebase-admin/functions';
import { requireAuth } from '../utils/auth.js';
import { getChapterById } from '../pipeline/debate/chapter.js';
import { checkChapter } from '../pipeline/fact-check/fact-check-runner.js';
import {
	startFactCheckResult,
	appendFactCheckFindings,
	resetFactCheckProgress,
	markFactCheckCompleted,
	failFactCheckResult
} from '../pipeline/fact-check/fact-check-repository.js';
import type { FactCheckFinding } from '../types/fact-check.types.js';
import type { SearchResult } from '../search/grounding.js';

const REGION = 'asia-northeast1';
const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'];

type FactCheckTaskPayload = { topicId: string; chapterId: string };

/** finding の出典を URL 重複排除で集約する（章全体で参照した出典） */
const aggregateSources = (findings: FactCheckFinding[]): SearchResult[] => {
	const seen = new Set<string>();
	const sources: SearchResult[] = [];
	for (const finding of findings) {
		for (const source of finding.sources) {
			if (!seen.has(source.url)) {
				seen.add(source.url);
				sources.push(source);
			}
		}
	}
	return sources;
};

/**
 * 完了章のファクトチェックを手動起動する。検証本体は重く onCall の 540 秒に収まらない章があるため、
 * ここでは前提検証と running 書き込みだけ行い、検証はタスク（最大30分）へ投げて即返す。
 */
export const runFactCheck = onCall(async (request) => {
	requireAuth(request);
	const { topicId, chapterId } = request.data as FactCheckTaskPayload;
	if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');
	if (!chapterId?.trim()) throw new HttpsError('invalid-argument', 'chapterId is required');

	const chapter = await getChapterById(topicId, chapterId);
	if (!chapter) throw new HttpsError('not-found', 'chapter not found');
	if (chapter.status !== 'completed') {
		throw new HttpsError('failed-precondition', 'chapter is not completed');
	}

	// 開始時に旧結果を削除し running を書く（1.5, 4.3）
	await startFactCheckResult(topicId, chapterId);
	// 検証本体はタスクで実行（最大30分・1GiB）
	const queue = getFunctions().taskQueue(`locations/${REGION}/functions/runFactCheckTask`);
	await queue.enqueue({ topicId, chapterId } satisfies FactCheckTaskPayload);
	return { topicId, chapterId };
});

const MAX_ATTEMPTS = 3;

/**
 * 章全体のファクトチェックを実行するタスク。発言ごとに指摘を逐次追記し、完了で completed を書く。
 * onCall の 540 秒制限を回避するため、タイムアウトは 1800 秒（タスクの実質上限）。
 */
export const runFactCheckTask = onTaskDispatched(
	{
		timeoutSeconds: 1800,
		memory: '1GiB',
		region: REGION,
		secrets: SECRETS,
		retryConfig: { maxAttempts: MAX_ATTEMPTS, minBackoffSeconds: 30 },
		rateLimits: { maxConcurrentDispatches: 5 }
	},
	async (req) => {
		const { topicId, chapterId } = req.data as FactCheckTaskPayload;
		try {
			// 再試行は全発言を再検証して再追記するため、追記済みの部分結果を一旦クリアして重複を防ぐ
			if ((req.retryCount ?? 0) > 0) {
				await resetFactCheckProgress(topicId, chapterId);
			}
			// 発言ごとに指摘が確定するたびに結果ドキュメントへ追記する（逐次表示）
			const result = await checkChapter({ topicId, chapterId }, async (findings) => {
				await appendFactCheckFindings(topicId, chapterId, findings, aggregateSources(findings));
			});
			if (!result.ok) {
				// NOT_FOUND 等の論理エラーはリトライしても直らないため failed を書いて終える
				const message = 'message' in result.error ? result.error.message : result.error.code;
				await failFactCheckResult(topicId, chapterId, message);
				return;
			}
			await markFactCheckCompleted(topicId, chapterId);
		} catch (err) {
			console.error(
				'[runFactCheckTask] error',
				{ topicId, chapterId, retryCount: req.retryCount },
				err
			);
			// 最終試行で失敗したら failed を記録（討論本体には触れない / 6.1）
			if ((req.retryCount ?? 0) >= MAX_ATTEMPTS - 1) {
				await failFactCheckResult(
					topicId,
					chapterId,
					err instanceof Error ? err.message : String(err)
				);
			}
			throw err; // 最終試行までは Cloud Tasks にリトライさせる
		}
	}
);
