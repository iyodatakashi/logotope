/**
 * LLM 呼び出しの使用量を、呼び出し元を変えずに記録する。
 *
 * 目的: どの工程がいくら使っているかを推測ではなく実測で持つ。これが無かったため、
 * トピック単価・プロンプト内訳とも見積もりを何度も外した（経緯は steering の project-knowledge.md）。
 *
 * 仕組みは2段。
 *   1. `usageRecorder` を `wrapLanguageModel` の middleware に挟む（models.ts の2箇所だけ）。
 *      これで全呼び出しのトークンが取れるが、判るのは「モデル別の合計」まで。
 *   2. 工程名は `llmTask` で括る。sonnet は意欲評価も発言生成も所感も通るため、
 *      モデル別合計だけでは工程を分離できない。AsyncLocalStorage なので、
 *      Promise.all で並列に走らせても各呼び出しが正しい工程名を持つ。
 *
 * 単価は「都度入力・キャッシュ読み・キャッシュ書き・出力」で3〜4段に分かれるため、
 * 合算値ではなく内訳のまま出す。集計側で単価を掛ける。
 *
 * 集計（ローカル実行のログから工程別トークンを出す例）:
 *   grep '\[llm-usage\]' run.log | sed 's/^.*\[llm-usage\] //' \
 *     | jq -s 'group_by(.task) | map({task: .[0].task, calls: length,
 *         noCache: map(.noCache) | add, cacheRead: map(.cacheRead) | add,
 *         cacheWrite: map(.cacheWrite) | add, output: map(.output) | add})'
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LanguageModelV3Middleware } from '@ai-sdk/provider';

const taskContext = new AsyncLocalStorage<string>();

/**
 * 関数を工程名で括る。中で走った LLM 呼び出しがその工程として記録される。
 * 引数・戻り値はそのまま通すので、呼び出し側は変わらない。
 */
export const llmTask =
	<Args extends unknown[], Result>(task: string, run: (...args: Args) => Promise<Result>) =>
	(...args: Args): Promise<Result> =>
		taskContext.run(task, () => run(...args));

/**
 * 1回の生成ごとに使用量を構造化ログで出す。ツールを使う呼び出し（発言生成の検索など）は
 * 内部で複数回モデルを叩くため、そのステップ数だけ発火する＝実コストがそのまま出る。
 */
export const usageRecorder: LanguageModelV3Middleware = {
	specificationVersion: 'v3',
	wrapGenerate: async ({ doGenerate, model }) => {
		const result = await doGenerate();
		// 記録は観測のためだけのもの。ここで落ちて生成そのものを壊さないよう、失敗しても握りつぶす。
		try {
			const usage = result.usage;
			console.info(
				'[llm-usage]',
				JSON.stringify({
					task: taskContext.getStore() ?? 'unknown',
					model: model.modelId,
					noCache: usage?.inputTokens?.noCache ?? 0,
					cacheRead: usage?.inputTokens?.cacheRead ?? 0,
					cacheWrite: usage?.inputTokens?.cacheWrite ?? 0,
					output: usage?.outputTokens?.total ?? 0
				})
			);
		} catch (err) {
			console.warn('[llm-usage] 記録に失敗', err);
		}
		return result;
	}
};
