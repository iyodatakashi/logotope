# Research & Design Decisions

## Summary
- **Feature**: `persona-interview-grounding-pipeline`
- **Discovery Scope**: Extension（既存 `interview-agent.ts` の再設計）
- **Key Findings**:
  - `@ai-sdk/google` v3 では Search Grounding は `google.tools.googleSearch({})`（プロバイダ定義ツール、名前は `google_search` 必須）で有効化する。旧来の `useSearchGrounding: true` モデル設定は廃止されている。
  - **Google Search グラウンディングと構造化出力（responseSchema / `Output.object`）の併用は AI SDK では未対応**。ネイティブ Gemini 3 API は対応するが、`ai` v6 / `@ai-sdk/google` v3 はまだ露出していない（vercel/ai #11599 が機能要望）。古い組み合わせは `400 controlled generation is not supported with google_search tool` を返す。
  - グラウンディング結果（参照URL・検索クエリ）は `result.providerMetadata.google.groundingMetadata` から取得する。`groundingChunks[].web.{uri,title}` がソース、`webSearchQueries[]` が Google が実行したクエリ。

## Research Log

### Search Grounding の有効化方法（@ai-sdk/google v3）
- **Context**: 要件 2 でネイティブ検索を使うため、現行 SDK でのグラウンディング有効化方法を確認する必要があった。
- **Sources Consulted**: `node_modules/@ai-sdk/google/dist/index.d.ts`（インストール済み v3.0.83）、[Grounding with Google Search](https://ai.google.dev/gemini-api/docs/google-search)
- **Findings**:
  - `googleTools.googleSearch` は `ProviderToolFactory`。`tools: { google_search: google.tools.googleSearch({}) }` の形で `generateText` に渡す。
  - `timeRangeFilter`（startTime/endTime）で期間指定が可能。
  - メタデータ型 `GoogleGenerativeAIGroundingMetadata` は `webSearchQueries`・`groundingChunks`・`groundingSupports`・`searchEntryPoint` を含む。
- **Implications**: 検証フェーズは `generateText` + `google_search` ツールで実装。ソース抽出は `providerMetadata.google.groundingMetadata.groundingChunks` を `{title, url}` に変換する。

### グラウンディングと構造化出力の非互換
- **Context**: ドラフト生成・最終生成は構造化出力が必要。検証はグラウンディングが必要。これらを同一コールにできるか確認。
- **Sources Consulted**: [vercel/ai #11599](https://github.com/vercel/ai/issues/11599)、[python-genai #665](https://github.com/googleapis/python-genai/issues/665)、[Structured output docs](https://ai.google.dev/gemini-api/docs/structured-output)、プロジェクト既存コミット `2bceeb2`（Gemini 2.5 Pro の tools+JSON 非互換対応）
- **Findings**:
  - ネイティブ Gemini 3 は併用可だが、AI SDK は未露出。プロジェクトは過去に同種の非互換（tools+JSON）に遭遇済み。
  - 安全策はグラウンディング（テキスト出力）と構造化出力（JSON）を別コールに分離すること。
- **Implications**: パイプラインを「構造化（検索なし）」と「グラウンディング（テキスト）」のフェーズに分離する設計が必須。4フェーズ分割（ドラフト→検証→ギャップ→最終）はこの制約と自然に整合する。

### sources（SearchSource[]）へのマッピング
- **Context**: 要件 5 で `SearchSource = { query, summary, results }` の出力形式維持が求められる。グラウンディングメタデータとの対応を確認。
- **Findings**:
  - グラウンディングは `webSearchQueries`（クエリ一覧）と `groundingChunks`（ソース一覧）を**別々のフラットな配列**で返す。クエリごとにソースを紐づける構造はない。
  - したがって「クエリ→結果」の1対多グルーピングはグラウンディングからは復元できない。
- **Implications**: 1回の検証グラウンディングコールを1つの `SearchSource` 集約エントリにマッピングする。`query` は `webSearchQueries` を結合、`summary` は検証サマリー、`results` は `groundingChunks` を重複排除した `{title,url}` 配列とする。UIの「サマリー→リンク群」表示と整合する。

### groundingChunks の uri はリダイレクトURL（実URL解決が必要）
- **Context**: 実装後、`sources` の URL がほぼ開けない（存在しない）という問題が発覚。
- **Findings**: `groundingChunks[].web.uri` は実際の記事URLではなく `vertexaisearch.cloud.google.com/grounding-api-redirect/...` 形式のリダイレクトURLを返す。これは短命で、直接開くと無効になることが多い。
- **Implications**: `extractSources` で得た各URLを `fetch(url, { method: 'HEAD', redirect: 'follow' })` の `response.url`（リダイレクト先の実URL）に解決してから `sources` に格納する（`resolveSourceUrls`）。解決失敗時は元URLのまま残す。Functions の追加レイテンシは並列実行＋5秒タイムアウトで抑える。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 単一コール + グラウンディング併用 | 1回の generateText でグラウンディング+構造化出力 | コール数最小 | AI SDK 未対応で 400 エラー確実 | 不採用 |
| 3フェーズ分割（採用） | ①ドラフト(構造化)→②検証(グラウンディング/テキスト)→③最終(構造化) | SDK制約を回避、確証バイアス対策が明示的、各段が単一責務 | LLMコール3回で latency 増 | 300秒タイムアウト内に収まる想定 |
| LangGraph等の外部オーケストレータ導入 | 状態機械でループ制御 | 複雑な分岐に強い | 依存追加・過剰、steering の「過度な抽象化禁止」に反する | 不採用 |

## Design Decisions

### Decision: 3フェーズ・パイプラインへの分割
- **Context**: グラウンディングと構造化出力が AI SDK で併用不可。かつ確証バイアスを避けた批判的検証が必要（要件2）。
- **Alternatives Considered**:
  1. 単一コール — SDK制約で不可。
  2. 4コール（検証とギャップ抽出を分離） — ギャップを構造化JSONで抽出できるが、コール追加でlatency増。検証テキストを最終生成LLMが直接読めるため過剰。
- **Selected Approach**: ①ドラフト生成（`generateObject`、検索なし）→②批判的検証（`generateText` + `google_search`、テキスト出力、ソース抽出）→③最終生成（`generateObject`、検索なし、ドラフト+検証レポートを参照入力）の3コール。
- **Rationale**: SDK制約を回避しつつ、検証フェーズをテキスト出力にすることでグラウンディングのソースを確実に取得できる。ギャップはフェーズ②の検証レポート（「一致点／相違点／新発見」をセクション化したテキスト）として独立変数で保持し、③へ参照渡しする。ドラフトを書き換えずゼロから再生成するため、ステレオタイプのノイズを引き継がない（要件4）。
- **Trade-offs**: LLMコールが1→3回に増えコスト・latencyが上がる。品質向上が目的なので許容。
- **Follow-up**: gemini-3.1-pro-preview のグラウンディング+thinkingの応答時間を実測し、300秒タイムアウトの妥当性を確認。

### Decision: 検証フェーズの反証プロンプト設計
- **Context**: ステレオタイプのドラフトを起点に検証すると確証バイアスでドラフトに引っ張られる（要件2.2/2.3）。
- **Selected Approach**: 検証プロンプトで「各項目について、それが誤りである／実態が異なる証拠を優先的に探せ」と明示し、検索を反証起点で行わせる。出力は「ドラフトが正しかった点／実態と異なった点／ステレオタイプで見えていなかった点」の3区分テキスト。
- **Rationale**: プロンプトレベルで反証姿勢を強制することが確証バイアス回避の唯一の現実的手段。
- **Trade-offs**: モデル依存。完全な反証保証はできないが、現状の「確認のみ」より大幅に改善。

### Decision: Tavily の段階的扱い
- **Context**: 要件からは Tavily 全廃を分離（Google検索の品質確認後に判断）。
- **Selected Approach**: `interview-agent.ts` は Tavily を import しない。`interviews.ts` の `SECRETS` から未使用となる `TAVILY_API_KEY` を外す。`@tavily/core` パッケージ自体と `search-service.ts`（persona-agent が使用）は残す。
- **Rationale**: 取材フローからの依存除去のみ行い、パッケージ全廃は別判断に委ねる。

## Risks & Mitigations
- グラウンディング+構造化出力を将来 SDK が併用対応してもフェーズ分割は不要にならない（批判的検証の独立性のため）。— 設計はSDK対応に依存しない。
- gemini-3.1-pro-preview のグラウンディング応答が遅く300秒を超える可能性。— タイムアウト引き上げ（最大540秒）で対応可能。実測で判断。
- グラウンディングが結果ゼロ／機能不可の場合。— 要件5/6に従いエラーを返し、未検証ドラフトは出力しない。

## References
- [Grounding with Google Search - Gemini API](https://ai.google.dev/gemini-api/docs/google-search) — googleSearch ツールとグラウンディングメタデータの仕様
- [Structured outputs - Gemini API](https://ai.google.dev/gemini-api/docs/structured-output) — 構造化出力とツール併用の制約
- [vercel/ai #11599](https://github.com/vercel/ai/issues/11599) — AI SDK でのグラウンディング+構造化出力併用の機能要望（未対応の根拠）
- [python-genai #665](https://github.com/googleapis/python-genai/issues/665) — controlled generation と google_search の非互換エラー
