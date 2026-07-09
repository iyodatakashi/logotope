import { readEditorial, narrationWriter } from './editorial-repository.js';
import { buildIntroOutroInput, buildNarrationPart } from './element-builders.js';
import { finalizeEditingRun, finalizePendingEditorialElements } from './editing-lifecycle.js';
import { pipelineErrorMessage } from '../debate/utils.js';

// intro-outro ステップ本体。討論ダイジェスト → 導入・締めを「生成中 → 原本生成 → 整え中 → 完了」まで通し、統合保存
// editorial/0 の intro/outro へ status＋draft/final を段階的に部分上書きする。導入・締めは best-effort（片方の失敗が
// 他方・本文を止めない・Req 2.1, 2.2, 1.2）。同一 run のタスク再試行では既に原本のある要素を二重生成しない。
// チェーンの終端ステージとして、未完了要素を確定する終端スイープを行い、章の成否から編集全体の完了状態を確定する。

export const runIntroOutroStep = async (
	topicId: string,
	runId: string
): Promise<'generated' | 'stopped' | 'noop'> => {
	try {
		const inputResult = await buildIntroOutroInput(topicId);
		if (!inputResult.ok) {
			console.warn('[runIntroOutroStep] digest build failed', {
				topicId,
				runId,
				error: pipelineErrorMessage(inputResult.error)
			});
		} else {
			const editorial = await readEditorial(topicId);
			if (!editorial.intro.draft) {
				await buildNarrationPart('intro', inputResult.value, narrationWriter(topicId, 'intro'));
			}
			if (!editorial.outro.draft) {
				await buildNarrationPart('outro', inputResult.value, narrationWriter(topicId, 'outro'));
			}
		}
	} catch (err) {
		// best-effort: 予期せぬ例外でも完了確定を妨げないため握りつぶす（原本は不変）。
		console.warn('[runIntroOutroStep] unexpected error (best-effort)', { topicId, runId }, err);
	}

	// 終端スイープ: 生成に到達しなかった要素（生成待ち／生成中／整え中）を生成失敗へ確定する（Req 4.3）。
	try {
		await finalizePendingEditorialElements(topicId);
	} catch (err) {
		console.warn('[runIntroOutroStep] sweep failed (best-effort)', { topicId, runId }, err);
	}

	return await finalizeEditingRun(topicId, runId);
};
