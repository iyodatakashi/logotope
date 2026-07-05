import { isEditingActive } from './editing-lifecycle.js';
import { readRawChapters, runChapterEditStep, runCommentsEditStep } from './editing-step.js';
import { runIntroClosingStep } from './intro-closing-step.js';
import { enqueueEditingStep } from './enqueue-editing-step.js';
import type { EditingStepPayload } from './enqueue-editing-step.js';

// 編集を「1ステップ＝1 Cloud Task」のチェーンとして駆動する層。
// 停止ゲート（世代照合）→対象ステップ実行→次ステップ enqueue を行い、自己継続ループにする。
// 状態は毎回 Firestore（原本＋runId）から再構築するため冪等・再入可能。旧世代タスクはゲートで no-op。
// 依存方向は一方向（orchestrator → step / lifecycle / enqueue）。

/**
 * 1 編集ステップを処理する再入可能ディスパッチャ。
 * chapter: 対象章を編集して保存し、次章があれば次章ステップ、無ければ intro-closing ステップを投入する。
 *   章の構造検証不合格（failed）でも後続章の処理を止めず連鎖する（完了確定時に stopped 判定）。
 * intro-closing: イントロ・クロージングを best-effort 生成して保存し、コメントステップを投入する。
 *   生成失敗でも例外を投げず必ず comments へ連鎖する（finalize に非干渉）。
 * comments: 事後コメントを編集して保存し、編集ランを確定する（全章 completed→generated / failed 残存→stopped）。
 */
export const advanceEditing = async (payload: EditingStepPayload): Promise<void> => {
	const { topicId, runId, stepKind, chapterIndex } = payload;
	if (!(await isEditingActive(topicId, runId))) return;

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
			await enqueueEditingStep({ topicId, runId, stepKind: 'intro-closing', chapterIndex: -1 });
		}
		return;
	}

	if (stepKind === 'intro-closing') {
		await runIntroClosingStep(topicId, runId);
		await enqueueEditingStep({ topicId, runId, stepKind: 'comments', chapterIndex: -1 });
		return;
	}

	await runCommentsEditStep(topicId, runId);
};
