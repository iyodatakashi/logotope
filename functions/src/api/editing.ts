import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFirestore } from 'firebase-admin/firestore';
import { getTopicById } from '../pipeline/topics/topics.js';
import { getChaptersByTopicId } from '../pipeline/debate/chapter.js';
import { advanceEditing } from '../pipeline/editing/editing-orchestrator.js';
import { enqueueEditingStep } from '../pipeline/editing/enqueue-editing-step.js';
import {
	startEditingRun,
	resetEditingRun,
	stopEditingRun
} from '../pipeline/editing/editing-lifecycle.js';
import {
	regenerateChapter,
	regenerateIntro,
	regenerateOutro,
	regenerateImpression
} from '../pipeline/editing/regenerate-element.js';
import { isDebateCompleted } from '../pipeline/debate/debate-lifecycle.js';
import { requireAuth } from '../utils/auth.js';
import type { EditingStepPayload } from '../pipeline/editing/enqueue-editing-step.js';
import type { ArticleElement } from '../types/editorial.types.js';

// 編集フェーズ（Phase 6）の API。討論とライフサイクルが異なるため専用の onCall / onTaskDispatched を新設する。
// 編集は討論完了時に自動実行せず、管理者が startEditing を明示的に呼んだときのみ起動する（Req 1.4）。

const REGION = 'asia-northeast1';
const MAX_ATTEMPTS = 3;
const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

/**
 * 編集を開始する。既存の編集成果物を破棄して phase6/running・新 runId にし、原本コメント生成ステージを投入する。
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
		// 編集の先頭は所感ステージ（原本生成→整えして統合保存へ書く）。後続で章編集→導入/締め＋完了確定へ連鎖する。
		await enqueueEditingStep({ topicId, runId, stepKind: 'impressions', chapterIndex: -1 });

		return { topicId };
	} catch (err) {
		console.error('[startEditing] error', { topicId }, err);
		throw err instanceof HttpsError
			? err
			: new HttpsError('internal', err instanceof Error ? err.message : String(err));
	}
});

/**
 * 記事要素の個別再生成の共通入口（薄い呼び出し口）。認証・「編集実行中は受け付けない」拒否・
 * 種別ごとのコア関数への振り分け・失敗のエラー化だけを行う。ロジックはコア関数（regenerate-element）が持つ。
 * 実行中（phase editing かつ phaseStatus running）は failed-precondition で拒否する（Req 4.7）。
 */
export const regenerateArticleElement = onCall(
	{ timeoutSeconds: 300, secrets: SECRETS },
	async (request) => {
		requireAuth(request);
		const { topicId, element } = request.data as { topicId?: string; element?: ArticleElement };
		if (!topicId?.trim() || !element?.kind) {
			throw new HttpsError('invalid-argument', 'topicId and element are required');
		}

		try {
			const snap = await getFirestore().doc(`topics/${topicId}`).get();
			if (!snap.exists) throw new HttpsError('not-found', 'Topic not found');
			const topic = snap.data() as { phase?: string; phaseStatus?: string };
			if (topic.phase === 'editing' && topic.phaseStatus === 'running') {
				throw new HttpsError('failed-precondition', 'Editing is running');
			}

			switch (element.kind) {
				case 'chapter':
					if (!element.chapterId?.trim()) {
						throw new HttpsError('invalid-argument', 'chapterId is required');
					}
					await regenerateChapter(topicId, element.chapterId);
					break;
				case 'intro':
					await regenerateIntro(topicId);
					break;
				case 'outro':
					await regenerateOutro(topicId);
					break;
				case 'impression':
					if (!element.personaId?.trim()) {
						throw new HttpsError('invalid-argument', 'personaId is required');
					}
					await regenerateImpression(topicId, element.personaId);
					break;
				default:
					throw new HttpsError('invalid-argument', 'unknown element kind');
			}

			return { topicId };
		} catch (err) {
			console.error('[regenerateArticleElement] error', { topicId, element }, err);
			throw err instanceof HttpsError
				? err
				: new HttpsError('internal', err instanceof Error ? err.message : String(err));
		}
	}
);

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
