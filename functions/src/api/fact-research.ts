import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { requireAuth } from '../utils/auth.js';
import { runFactResearch } from '../agents/fact-research-agent.js';
import { confirmPhaseGenerated } from '../utils/topic-phase.js';
import type { FactBaseForFirestore } from '../types/factBase.types.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'TAVILY_API_KEY'];

const db = () => getFirestore();

export const generateFactResearch = onCall(
	{ timeoutSeconds: 300, secrets: SECRETS },
	async (request) => {
		requireAuth(request);
		const { topicId, title } = request.data as { topicId: string; title: string };
		if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');
		if (!title?.trim()) throw new HttpsError('invalid-argument', 'title is required');

		const result = await runFactResearch(title, new Date());
		if (!result.ok) {
			const message = 'message' in result.error ? result.error.message : result.error.code;
			console.error('[generateFactResearch] error', { topicId, title }, result.error);
			throw new HttpsError('internal', message);
		}

		// ユーザー提供資料（sourceContents）とは別のサブコレクション文書に、生成基準日・出典付きで永続する。
		// 空 grounding（facts:[]）も同経路で保存する（縮退・再実行）。承認前の再実行は上書き再生成になる。
		const factBase: FactBaseForFirestore = {
			facts: result.value.facts,
			generatedAt: Timestamp.fromDate(result.value.generatedAt)
		};
		await db().doc(`topics/${topicId}/factBase/0`).set(factBase);

		// 完了状態はサーバ権威で確定する。running のときだけ generated へ冪等遷移させる。
		await confirmPhaseGenerated(topicId, 'fact-research');
		return {};
	}
);
