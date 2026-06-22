/**
 * Spike: gemini-2.5-pro Google Search Grounding 動作確認
 *
 * 目的:
 *   - google_search ツール付き generateText の動作確認
 *   - providerMetadata.google.groundingMetadata の構造と内容を確認
 *   - 3フェーズ直列実行の latency 見積もり
 *
 * 実行:
 *   GEMINI_API_KEY=<key> npx tsx spike-grounding.ts
 *
 * 完了条件:
 *   - 実行ログに実際の参照URL・タイトルと Google 検索クエリが出力される
 *   - または grounding 不可の事実が確認され代替（Tavily）採用を判断する
 */
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { GoogleGenerativeAIProviderMetadata } from '@ai-sdk/google';

type GroundingMetadata = NonNullable<GoogleGenerativeAIProviderMetadata['groundingMetadata']>;

const main = async () => {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) throw new Error('GEMINI_API_KEY is required');

	const google = createGoogleGenerativeAI({ apiKey });
	const model = google('gemini-2.5-pro');

	console.log('=== Phase2 grounding spike ===');
	console.log('Model: gemini-2.5-pro + google_search');
	console.log('Starting...\n');

	const startTime = Date.now();

	const result = await generateText({
		model,
		tools: {
			google_search: google.tools.googleSearch({})
		},
		messages: [
			{
				role: 'user',
				content: `以下のドラフト信念について、各項目が誤り・実態と異なる証拠を優先的に探してください（反証起点）。

【ドラフト信念：テーマ「日本の少子化問題」、ペルソナ：30代共働き会社員】
- 立場と根拠: 子育てコストが高すぎて子どもを持てない
- 核心的主張: 保育所不足が少子化の主因
- 懸念事項: 職場の育休取得しにくい雰囲気
- 価値観: 仕事と家庭を両立したい
- 妥協点: 1人ならなんとかなるかもしれない
- 変化の可能性: 政策が変われば考えが変わる可能性あり

各項目について「このステレオタイプは本当に正しいか」「実態が異なる証拠はないか」を検索し、以下の書式で回答してください：

## 一致点
- ドラフトの主張: [項目]
  実態: [検証で確認された内容]
  根拠URL: [URL]

## 相違点
- ギャップ: [ズレ]
  実態: [判明した実態]
  根拠URL: [URL]

## 新発見
- 観点: [ステレオタイプで見えていなかった側面]
  内容: [具体的内容]
  根拠URL: [URL]`
			}
		]
	});

	const elapsed = Date.now() - startTime;

	console.log('=== Response time ===');
	console.log(`${elapsed}ms (${(elapsed / 1000).toFixed(1)}s)`);
	console.log('（3フェーズ直列推定: Phase1 ~10s + Phase2 this + Phase3 ~15s）\n');

	const groundingMetadata = result.providerMetadata?.google
		?.groundingMetadata as GroundingMetadata | null;

	if (!groundingMetadata) {
		console.error('❌ groundingMetadata が返りませんでした');
		console.error('→ 代替（Tavily ツール）への切り替えを検討してください');
		process.exit(1);
	}

	console.log('=== Google Search Queries ===');
	if (groundingMetadata.webSearchQueries?.length) {
		groundingMetadata.webSearchQueries.forEach((q) => console.log('-', q));
	} else {
		console.warn('webSearchQueries が空です');
	}

	console.log('\n=== Grounding Chunks (Sources) ===');
	if (groundingMetadata.groundingChunks?.length) {
		groundingMetadata.groundingChunks.forEach((chunk, i) => {
			if (chunk.web) {
				console.log(`${i + 1}. [${chunk.web.title ?? 'no title'}](${chunk.web.uri})`);
			}
		});
		console.log(`\n✅ ${groundingMetadata.groundingChunks.length} 件のソースを取得`);
	} else {
		console.error('❌ groundingChunks が空です');
		console.error('→ grounding 機能が動作していない可能性があります');
		process.exit(1);
	}

	console.log('\n=== Text Response (先頭 800 字) ===');
	console.log(result.text.slice(0, 800));
	console.log('\n=== Spike 完了: メタデータ取得方法が確定しました ===');
};

main().catch((err) => {
	console.error('Spike failed:', err);
	process.exit(1);
});
