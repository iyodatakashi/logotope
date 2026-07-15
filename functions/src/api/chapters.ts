import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { requireAuth } from '../utils/auth.js';
import { planChapters } from '../pipeline/chapters/chapter-generator.js';
import { discardChaptersWithAnalysis } from '../pipeline/chapters/chapter-discard.js';
import { resetDebate } from '../pipeline/debate/debate-lifecycle.js';
import { clearEditedArtifact } from '../pipeline/editing/edited-repository.js';
import { confirmPhaseGenerated, setTopicPhaseStatus } from '../utils/topic-phase.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'TAVILY_API_KEY'];

const db = () => getFirestore();

/**
 * 章立て再生成をサーバ権威で所有する。単一操作で「chapters を running に確定＋新世代 runId（手順1・単一
 * update・原子的）→ 旧章立て・付随分析＋下流（debate/editing）破棄（手順2）→ 章生成・generated 確定（手順3）」を
 * この順序で実行する。手順1を先に置き新 runId を発行することで、approved 起点の再生成でも下流が完了表示にならず、
 * 旧世代の残タスクを無効化して中間の窓を作らない（R3.1, 3.3, 3.5）。初回生成は破棄が no-op で同一経路を通る。
 * 手順1後の失敗は chapters/stopped に留め、下流 approved へ戻さない（R3.4）。
 */
export const generateChapters = onCall(
	{ timeoutSeconds: 540, secrets: SECRETS },
	async (request) => {
		requireAuth(request);
		const { topicId } = request.data as { topicId: string };
		if (!topicId) throw new HttpsError('invalid-argument', 'topicId is required');

		const snap = await db().doc(`topics/${topicId}`).get();
		if (!snap.exists) throw new HttpsError('not-found', 'Topic not found');

		// 手順1: chapters を running に確定＋新世代 runId（単一 update・原子的）。
		const runId = nanoid();
		await db()
			.doc(`topics/${topicId}`)
			.update({ phase: 'chapters', phaseStatus: 'running', runId, updatedAt: Timestamp.now() });

		try {
			// 手順2: 旧章立て・付随分析＋下流（debate/editing）破棄（初回生成は no-op）。
			await discardChaptersWithAnalysis(topicId);
			await resetDebate(topicId);
			await clearEditedArtifact(topicId);

			// 手順3: 章生成 → 完了状態はサーバ権威で確定（running のときだけ generated へ冪等遷移）。
			await planChapters(topicId);
			await confirmPhaseGenerated(topicId, 'chapters');
		} catch (err) {
			// 手順1後の失敗は対象フェーズのまま停止（下流 approved へ戻さない・R3.4）。
			console.error('[generateChapters] error', { topicId }, err);
			await setTopicPhaseStatus(topicId, 'chapters', 'stopped');
			throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
		}

		return { topicId };
	}
);
