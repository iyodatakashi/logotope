import { readEditorial, narrationWriter } from './editorial-repository.js';
import { buildIntroOutroInput, buildNarrationPart } from './editorial-builders.js';
import { finalizeEditingRun, finalizePendingEditorials } from './editing-lifecycle.js';
import { pipelineErrorMessage } from '../debate/utils.js';

// intro-outro ステップ本体。討論ダイジェスト → 導入・締めを「生成中 → 原本生成 → 整え中 → 完了」まで通し、統合保存
// editorial/outputs の intro/outro へ status＋draft/final を段階的に部分上書きする。導入・締めは best-effort（片方の失敗が
// 他方・本文を止めない・Req 2.1, 2.2, 1.2）。同一 run のタスク再試行では既に原本のある要素を二重生成しない。
// チェーンの終端ステージとして、未完了要素を確定する終端スイープを行い、章の成否から編集全体の完了状態を確定する。

export const runIntroOutroStep = async (
	topicId: string,
	runId: string
): Promise<'generated' | 'stopped' | 'noop'> => {
	try {
		// 未生成（原本なし）の導入・締めを対象に、生成中への切替を重い前処理（ダイジェスト構築）より前に出す
		// （R1.2/R4.2。既に原本のある要素は二重生成しないため対象外・run 内リトライ保護と両立）。
		const editorial = await readEditorial(topicId);
		const kinds = (['intro', 'outro'] as const).filter((kind) => !editorial[kind].draft);
		for (const kind of kinds) {
			await narrationWriter(topicId, kind).markEditorialGenerating();
		}

		const inputResult = await buildIntroOutroInput(topicId);
		if (!inputResult.ok) {
			// 生成中のまま残さない（未達要素の生成失敗への確定は終端スイープの責務・R3.2）。
			console.warn('[runIntroOutroStep] digest build failed', {
				topicId,
				runId,
				error: pipelineErrorMessage(inputResult.error)
			});
		} else {
			for (const kind of kinds) {
				await buildNarrationPart(kind, inputResult.value, narrationWriter(topicId, kind));
			}
		}
	} catch (err) {
		// best-effort: 予期せぬ例外でも完了確定を妨げないため握りつぶす（原本は不変）。
		console.warn('[runIntroOutroStep] unexpected error (best-effort)', { topicId, runId }, err);
	}

	// 終端スイープ: 生成に到達しなかった要素（生成待ち／生成中／整え中）を生成失敗へ確定する（Req 4.3）。
	try {
		await finalizePendingEditorials(topicId);
	} catch (err) {
		console.warn('[runIntroOutroStep] sweep failed (best-effort)', { topicId, runId }, err);
	}

	return await finalizeEditingRun(topicId, runId);
};
