import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { requireAuth } from '../utils/auth.js';
import { runFactResearch } from '../agents/fact-research-agent.js';
import { confirmPhaseGenerated, setTopicPhaseStatus } from '../utils/topic-phase.js';
import { discardStakeholders, discardPersonas } from '../pipeline/personas/personas.js';
import { discardChaptersWithAnalysis } from '../pipeline/chapters/chapter-discard.js';
import { resetDebate } from '../pipeline/debate/debate-lifecycle.js';
import { clearEditedArtifact } from '../pipeline/editing/edited-repository.js';
import type { FactBaseForFirestore } from '../types/factBase.types.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'TAVILY_API_KEY'];

const db = () => getFirestore();

/**
 * 事実リサーチ再生成をサーバ権威で所有する。単一操作で「fact-research を running に確定（手順1）→
 * 全下流破棄（手順2）→ 事実基盤生成・generated 確定（手順3）」をこの順序で実行する。
 * 手順1を先に置くことで、approved（下流）起点の再生成でも下流フェーズが完了表示にならない（R3.1, 3.3）。
 * 手順1後の失敗は fact-research/stopped に留め、下流 approved へ戻さない（R3.4）。
 * 下流破棄はクライアント側 reset 群（stakeholders/personas/chapters/debate/editing）と同順・同範囲。
 */
export const generateFactResearch = onCall(
	{ timeoutSeconds: 300, secrets: SECRETS },
	async (request) => {
		requireAuth(request);
		const { topicId, title, description } = request.data as {
			topicId: string;
			title: string;
			description?: string;
		};
		if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');
		if (!title?.trim()) throw new HttpsError('invalid-argument', 'title is required');

		// 手順1: fact-research を running に確定（単一 update・原子的）。
		await setTopicPhaseStatus(topicId, 'fact-research', 'running');

		try {
			// 手順2: 全下流を破棄（初回生成は no-op）。事実基盤（自層）は下の set で上書き再生成する。
			await discardStakeholders(topicId);
			await discardPersonas(topicId);
			await discardChaptersWithAnalysis(topicId);
			await resetDebate(topicId);
			await clearEditedArtifact(topicId);

			// 手順3: 生成し、出典・生成基準日付きで永続する（空 grounding も同経路）。
			const result = await runFactResearch(title, description ?? '', new Date());
			if (!result.ok) {
				const message = 'message' in result.error ? result.error.message : result.error.code;
				throw new HttpsError('internal', message);
			}
			const factBase: FactBaseForFirestore = {
				facts: result.value.facts,
				generatedAt: Timestamp.fromDate(result.value.generatedAt)
			};
			await db().doc(`topics/${topicId}/factBase/0`).set(factBase);

			// 完了状態はサーバ権威で確定する。running のときだけ generated へ冪等遷移させる。
			await confirmPhaseGenerated(topicId, 'fact-research');
		} catch (err) {
			// 手順1後の失敗は対象フェーズのまま停止（下流 approved へ戻さない・R3.4）。
			console.error('[generateFactResearch] error', { topicId, title }, err);
			await setTopicPhaseStatus(topicId, 'fact-research', 'stopped');
			throw err instanceof HttpsError
				? err
				: new HttpsError('internal', err instanceof Error ? err.message : String(err));
		}

		return {};
	}
);
