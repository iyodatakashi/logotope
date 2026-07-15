import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { clearEditedArtifact, readEditedChapters } from './edited-repository.js';
import { readEditorial, narrationWriter, impressionWriter } from './editorial-repository.js';
import { getPersonasByTopicId } from '../personas/personas.js';
import type { PhaseSlug, PhaseStatus } from '../../types/phase.types.js';

// 編集ランのライフサイクル: 開始（破棄＋実行中化＋新世代）と完了確定（全章成功→generated / 失敗残存→stopped）。
// 生ディベートは読み取りのみ。編集フェーズ（phase 6）の phaseStatus と runId のみを更新する。

const db = () => getFirestore();

/**
 * 編集ランを開始する。既存の記事（editedChapters ＋ 統合保存 editorial/0＝導入/締め/所感）を即時破棄し、
 * 編集フェーズを実行中にして新しい世代 runId を発行する（Req 5.1）。再実行時も同じ経路を通り、旧記事は
 * 開始時点で必ず消える（UX フィードバックと整合の両立）。破棄後、先頭の impressions ステージが作り直す。
 * （各ステージの「原本ありスキップ」は同一 run 内のタスクリトライ保護用で、ここでの破棄と両立する・Req 5.2）
 */
export const startEditingRun = async (topicId: string): Promise<string> => {
	await clearEditedArtifact(topicId);
	const runId = nanoid();
	await db()
		.doc(`topics/${topicId}`)
		.update({ phase: 'editing', phaseStatus: 'running', runId, updatedAt: Timestamp.now() });
	return runId;
};

/**
 * 編集を未実行状態へ戻す（リセット）。編集成果物を破棄し、編集フェーズを not_started にする。
 * 討論には触れず、原本は不変。再度 startEditingRun で編集を開始できる。
 */
export const resetEditingRun = async (topicId: string): Promise<void> => {
	await clearEditedArtifact(topicId);
	await db()
		.doc(`topics/${topicId}`)
		.update({ phase: 'editing', phaseStatus: 'not_started', updatedAt: Timestamp.now() });
};

/**
 * 終端失敗で編集ランを停止（stopped）にする。phase 6・runId 一致・phaseStatus running のときのみ遷移し、
 * 旧世代・前進済みを弾く（新世代の編集を巻き込まない）。再実行ボタンで復帰できる。
 * 停止が成立したら、生成に到達しなかった記事要素を生成失敗へ確定して生成待ち表示の固着を防ぐ（Req 4.3）。
 */
export const stopEditingRun = async (topicId: string, runId: string): Promise<void> => {
	const ref = db().doc(`topics/${topicId}`);
	const stopped = await db().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (!snap.exists) return false;
		const data = snap.data() as { phase?: PhaseSlug; phaseStatus?: PhaseStatus; runId?: string };
		if (data.phase !== 'editing' || data.runId !== runId || data.phaseStatus !== 'running') {
			return false;
		}
		tx.update(ref, { phaseStatus: 'stopped', updatedAt: Timestamp.now() });
		return true;
	});
	if (!stopped) return;
	try {
		await finalizePendingEditorialElements(topicId);
	} catch (err) {
		// best-effort: スイープ失敗が停止確定を妨げないよう握りつぶす。
		console.warn('[stopEditingRun] editorial sweep failed (best-effort)', { topicId, runId }, err);
	}
};

/**
 * 終端スイープ: 完了（finished）に達しなかった記事要素（生成待ち／生成中／整え中）を完了に確定する（Req 4.3）。
 * 既存内容は保持する（原本があれば編集失敗、無ければ空＝生成失敗）。承認済みペルソナの所感でエントリの無い
 * ／未完了のものにも失敗エントリを materialize する。既に finished の要素は変更しない（冪等・再入安全）。
 */
export const finalizePendingEditorialElements = async (topicId: string): Promise<void> => {
	const editorial = await readEditorial(topicId);

	for (const kind of ['intro', 'outro'] as const) {
		const part = editorial[kind];
		if (part.status !== 'finished') {
			await narrationWriter(topicId, kind).finish({ draft: part.draft, final: part.final });
		}
	}

	const personas = (await getPersonasByTopicId(topicId)).filter((persona) => persona.selected);
	for (let i = 0; i < personas.length; i++) {
		const persona = personas[i];
		const existing = editorial.impressions[persona.id];
		if (!existing || existing.status !== 'finished') {
			const sortOrder = existing?.sortOrder ?? i;
			await impressionWriter(topicId, persona.id, sortOrder).finish({
				draft: existing?.draft ?? null,
				final: existing?.final ?? null
			});
		}
	}
};

/** 編集ランが稼働中（phase 6・phaseStatus running・runId 一致）かを判定する。旧世代タスクを弾く */
export const isEditingActive = async (topicId: string, runId: string): Promise<boolean> => {
	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) return false;
	const data = snap.data() as { phase?: PhaseSlug; phaseStatus?: PhaseStatus; runId?: string };
	return data.phase === 'editing' && data.phaseStatus === 'running' && data.runId === runId;
};

/**
 * 編集ランを確定する。全 editedChapters が completed なら generated、1 章でも failed が残れば stopped。
 * phase 6・runId 一致・phaseStatus ∈ {running, stopped} のときのみ遷移し、巻き戻し（generated→stopped 等）を防ぐ。
 * 世代不一致・前進済みは書き込まず noop を返す（冪等）。
 */
export const finalizeEditingRun = async (
	topicId: string,
	runId: string
): Promise<'generated' | 'stopped' | 'noop'> => {
	const chapters = await readEditedChapters(topicId);
	const allCompleted =
		chapters.length > 0 && chapters.every((chapter) => chapter.status === 'completed');
	const nextStatus: 'generated' | 'stopped' = allCompleted ? 'generated' : 'stopped';

	const ref = db().doc(`topics/${topicId}`);
	return await db().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (!snap.exists) return 'noop';
		const data = snap.data() as { phase?: PhaseSlug; phaseStatus?: PhaseStatus; runId?: string };
		if (
			data.phase !== 'editing' ||
			data.runId !== runId ||
			(data.phaseStatus !== 'running' && data.phaseStatus !== 'stopped')
		) {
			return 'noop';
		}
		tx.update(ref, { phaseStatus: nextStatus, updatedAt: Timestamp.now() });
		return nextStatus;
	});
};
