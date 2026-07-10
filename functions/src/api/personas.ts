import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { requireAuth } from '../utils/auth.js';
import {
	generatePersonas as runPersonaGeneration,
	sourceTagForIndex
} from '../agents/persona-generator-agent.js';
import { getTopicContext } from '../pipeline/topics/topic-context.js';
import { confirmPhaseGenerated } from '../utils/topic-phase.js';
import type { Stakeholder } from '../types/stakeholder.types.js';
import type { GeneratedPersona } from '../agents/persona-generator-agent.js';

const db = () => getFirestore();

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'TAVILY_API_KEY'];

// 生成結果のエコー用タグから由来ステークホルダーの id を解決する（出力順非依存）。
// タグ欠落/不正時は、出力位置（k 番目→採用 k 番目）と役割名照合でフォールバックする。
// 生成件数は採用件数と一致するため、少なくとも位置フォールバックで必ず解決できる。
const resolveStakeholderId = (
	persona: GeneratedPersona,
	outputIndex: number,
	selected: Stakeholder[]
): string => {
	const byTag = selected.find((_, i) => sourceTagForIndex(i) === persona.sourceTag);
	if (byTag) return byTag.id;
	const byPosition = selected[outputIndex];
	if (byPosition) return byPosition.id;
	const byRole = selected.find((stakeholder) => stakeholder.role === persona.stakeholderRole);
	return (byRole ?? selected[0]).id;
};

export const generatePersonas = onCall(
	{ timeoutSeconds: 300, secrets: SECRETS },
	async (request) => {
		requireAuth(request);
		const { topicId, title, selectedStakeholderIds } = request.data as {
			topicId: string;
			title: string;
			selectedStakeholderIds: string[];
		};
		if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');
		if (!title?.trim()) throw new HttpsError('invalid-argument', 'title is required');
		if (!Array.isArray(selectedStakeholderIds) || selectedStakeholderIds.length === 0)
			throw new HttpsError('invalid-argument', 'selectedStakeholderIds is required');

		const snap = await db().doc(`topics/${topicId}/stakeholders/0`).get();
		if (!snap.exists) throw new HttpsError('invalid-argument', 'stakeholders not found');
		const stakeholders = (snap.data() as { stakeholders: Stakeholder[] }).stakeholders;

		// 採用集合で決定的に絞り込む（順序保持）。未知 id が混じる場合は不正入力として拒否する。
		const selectedIdSet = new Set(selectedStakeholderIds);
		const selected = stakeholders.filter((stakeholder) => selectedIdSet.has(stakeholder.id));
		if (selected.length !== selectedIdSet.size)
			throw new HttpsError('invalid-argument', 'selectedStakeholderIds contains unknown id');

		const topicContext = await getTopicContext(topicId);
		const result = await runPersonaGeneration(title, selected, topicId, topicContext);
		if (!result.ok) {
			const message = 'message' in result.error ? result.error.message : result.error.code;
			console.error('[generatePersonas] error', { topicId, title }, result.error);
			throw new HttpsError('internal', message);
		}

		// 全ペルソナ文書を一括（batch）で永続化する。途中失敗では未コミット（全件 or 未書込）と
		// なり、不完全な成果物を残さない。結果の Single Source of Truth は Firestore。
		const batch = db().batch();
		result.value.personas.forEach((persona, index) => {
			// sourceTag は由来解決用の一時項目。永続前に stakeholderId へ畳んで除去する。
			const { id, sourceTag: _sourceTag, ...rest } = persona;
			batch.set(db().doc(`topics/${topicId}/personas/${id}`), {
				...rest,
				stakeholderId: resolveStakeholderId(persona, index, selected),
				sortOrder: index,
				approved: false,
				beliefs: [],
				createdAt: Timestamp.now()
			});
		});
		await batch.commit();
		// 永続化成功後、完了状態はサーバ権威で確定する。クライアントの生存や callable の
		// タイムアウトに依存せず、running のときだけ generated へ冪等遷移させる。
		await confirmPhaseGenerated(topicId, 'personas');
		return {};
	}
);
