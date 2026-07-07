import { isEditingActive } from './editing-lifecycle.js';
import { readRawChapters, runChapterEditStep, runImpressionsStep } from './editing-step.js';
import { runIntroOutroStep } from './intro-outro-step.js';
import { enqueueEditingStep } from './enqueue-editing-step.js';
import type { EditingStepPayload } from './enqueue-editing-step.js';

// 編集を「1ステップ＝1 Cloud Task」のチェーンとして駆動する層。
// 停止ゲート（世代照合）→対象ステップ実行→次ステップ enqueue を行い、自己継続ループにする。
// 状態は毎回 Firestore（原本＋runId）から再構築するため冪等・再入可能。旧世代タスクはゲートで no-op。
// 依存方向は一方向（orchestrator → step / lifecycle / enqueue）。

/**
 * 1 編集ステップを処理する再入可能ディスパッチャ。
 * impressions: 編集の先頭で承認済みペルソナごとに所感を原本生成→整えして統合保存へ書き、最初の章編集ステップを投入する。
 * chapter: 対象章を編集して保存し、次章があれば次章ステップ、無ければ intro-outro ステップを投入する。
 *   章の構造検証不合格（failed）でも後続章の処理を止めず連鎖する（完了確定時に stopped 判定）。
 * intro-outro: 導入・締めを best-effort で原本生成→整えして統合保存へ書き、編集ランを確定する（終端ステージ）。
 *   生成失敗でも例外を投げず、章の成否から完了状態を確定する（全章 completed→generated / failed 残存→stopped）。
 */
export const advanceEditing = async (payload: EditingStepPayload): Promise<void> => {
	const { topicId, runId, stepKind, chapterIndex } = payload;
	if (!(await isEditingActive(topicId, runId))) return;

	if (stepKind === 'impressions') {
		await runImpressionsStep(topicId);
		await enqueueEditingStep({ topicId, runId, stepKind: 'chapter', chapterIndex: 0 });
		return;
	}

	if (stepKind === 'chapter') {
		await runChapterEditStep(topicId, chapterIndex, runId);
		const chapters = await readRawChapters(topicId);
		const nextChapterIndex = chapterIndex + 1;
		if (nextChapterIndex < chapters.length) {
			await enqueueEditingStep({
				topicId,
				runId,
				stepKind: 'chapter',
				chapterIndex: nextChapterIndex
			});
		} else {
			await enqueueEditingStep({ topicId, runId, stepKind: 'intro-outro', chapterIndex: -1 });
		}
		return;
	}

	await runIntroOutroStep(topicId, runId);
};
