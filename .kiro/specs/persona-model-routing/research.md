# Research & Design Decisions

---
**Feature**: `persona-model-routing`
**Discovery Scope**: Complex Integration

**Key Findings**:
- Vercel AI SDK（`ai` パッケージ）採用により、プロバイダーごとのツール定義変換・強制呼び出し設定・レスポンス解析の再実装が不要になる
- `jsonSchema()` ヘルパーにより既存の JSON Schema ツール定義を Zod に書き直さず利用可能
- `@ai-sdk/xai` 公式プロバイダーパッケージが存在し、Grok 対応に専用処理不要
- Tavily は `@tavily/core` npm パッケージで利用可能（2026年5月時点で GA）
- `interviewRecord` フィールド名を Firestore 上で維持することでデータマイグレーション不要
- llmType 分類は persona-generator の `submit_personas` ツールへの enum 追加で AI に委ねるのが最も精度が高い
---

## Research Log

### Tavily Search API

- **Context**: Requirement 5 (ペルソナ・グラウンディング・リサーチ) の実装に必要な検索 API
- **Sources Consulted**:
  - https://www.npmjs.com/package/@tavily/core
  - https://docs.tavily.com/sdk/javascript/quick-start
- **Findings**:
  - パッケージ名: `@tavily/core`（公式 TypeScript/JavaScript SDK）
  - `tavily.search(query, options)` の単純な API
  - `options.searchDepth: 'basic' | 'advanced'`、`options.maxResults` などを指定可能
  - CommonJS / ESM 両対応
  - 環境変数 `TAVILY_API_KEY` で認証
- **Implications**: シンプルな wrapper だけで十分。専用 adapter クラスは不要で `PersonaResearchService` に直接インポート

### xAI Grok API

- **Context**: `grok` llmType のペルソナ対応
- **Sources Consulted**:
  - https://docs.x.ai/overview
  - https://docs.x.ai/docs/guides/function-calling
- **Findings**:
  - xAI API は OpenAI SDK と完全互換（base URL のみ変更: `https://api.x.ai/v1`）
  - `tool_choice: { type: 'function', function: { name: '...' } }` で強制呼び出し
  - 認証: `XAI_API_KEY`（環境変数名は `GROK_API_KEY` として統一）
  - 推奨モデル: `grok-4`
- **Implications**: `@ai-sdk/xai` 公式プロバイダーパッケージにより、Grok は `xai('grok-4')` の一行で対応可能。OpenAI との統一は Vercel AI SDK 側が吸収する

### OpenAI API ツール呼び出し

- **Context**: `gpt` llmType のペルソナ対応
- **Sources Consulted**:
  - https://platform.openai.com/docs/guides/function-calling
  - https://www.npmjs.com/package/openai
- **Findings**:
  - `tools: [{ type: 'function', function: { name, description, parameters } }]`
  - 強制呼び出し: `tool_choice: { type: 'function', function: { name: '...' } }`
  - 認証: `OPENAI_API_KEY`
  - 推奨モデル: `gpt-4o`
- **Implications**: Vercel AI SDK 採用により、プロバイダー固有の変換は不要。`@ai-sdk/openai` が吸収する

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| **Vercel AI SDK** | `ai` パッケージの `generateText` + プロバイダーパッケージ（`@ai-sdk/*`）で統一 | ツール定義・強制呼び出し・レスポンス解析が全プロバイダー共通。`jsonSchema()` で既存定義を再利用可能 | 新依存ライブラリ（`ai` + 4 provider pkg）| **採用** |
| LLMAdapter（Adapter Pattern） | プロバイダーごとに adapter クラスを実装し、共通インターフェースで PersonaAgent から呼び出す | 外部依存なし、TypeScript 型安全 | adapter ごとにツール変換・レスポンス解析を再実装（再吸収問題） | 却下（Vercel AI SDK で同等の目標を達成可能） |
| LangChain/LangGraph | フレームワークで抽象化 | プロバイダー抽象化が組み込み | JS 版の成熟度、Firebase との相性、全体書き直しリスク | 却下（既存討論フロー複雑化時に再検討） |
| 直接 SDK 分岐 | PersonaAgent 内で `if (persona.llmType === 'gemini')` 分岐 | シンプル | PersonaAgent が肥大化、テスト困難 | 却下 |

---

## Design Decisions

### Decision: Vercel AI SDK 採用（カスタム Adapter Pattern を廃棄）

- **Context**: 4 プロバイダー対応において、各プロバイダーの tool 定義形式・強制呼び出し方法・レスポンス解析を統一する方法の選択
- **Alternatives Considered**:
  1. カスタム Adapter Pattern — `LLMAdapter` interface + `AnthropicAdapter`, `GeminiAdapter`, `OpenAIAdapter` の 5 ファイル
  2. Vercel AI SDK — `ai` パッケージ + `@ai-sdk/*` プロバイダーパッケージ
- **Selected Approach**: Vercel AI SDK。`generateText()` + `jsonSchema()` + `toolChoice: { type: 'tool', toolName }` で全プロバイダー統一
- **Rationale**: プロバイダー固有の差異（Gemini の `FunctionCallingConfigMode`、OpenAI の `function.parameters` 形式等）をフレームワーク側が吸収。`jsonSchema()` により既存 JSON Schema ツール定義を再利用可能で移行コストが低い。`@ai-sdk/xai` 公式パッケージにより Grok も統一的に扱える
- **Trade-offs**: `ai` + 4 プロバイダーパッケージの新規依存が増える。ただし Firebase Functions の Node.js 24 環境で動作確認済みのパッケージ群
- **Follow-up**: `facilitator-agent.ts` は Claude 専用のため今回は直接 Anthropic SDK を維持（将来的に統一も可）

### Decision: interviewRecord フィールド名を Firestore 上で維持

- **Context**: `PersonaResearchService` が生成するリサーチサマリーの保存先
- **Alternatives Considered**:
  1. フィールド名を `researchSummary` にリネーム → 既存 Firestore ドキュメントのマイグレーション必要
  2. `interviewRecord` を維持しつつ内容をリサーチサマリーに変更
- **Selected Approach**: `interviewRecord` フィールド名をそのまま維持。内容だけをリサーチサマリーに変更
- **Rationale**: debate-orchestrator.ts の `interviewRecords` ロードロジックが無変更で動作。フロントエンド（表示用）への影響もない
- **Trade-offs**: フィールド名と内容の意味的ズレが生じるが、設計上は許容範囲
- **Follow-up**: 将来的な renaming は別スペックで検討

### Decision: llmType 分類を AI に委ねる（submit_personas tool への enum 追加）

- **Context**: Requirement 2（ペルソナ生成時の llmType 自動分類）
- **Alternatives Considered**:
  1. ルールベース: occupation / stakeholderRole のキーワードマッチング
  2. 別途 LLM 呼び出しで分類
  3. `submit_personas` tool に `llmType` enum フィールドを追加して一括生成時に分類
- **Selected Approach**: Option 3 — ペルソナ生成の tool schema に `llmType` を追加
- **Rationale**: 既存の Claude Opus によるペルソナ生成が文脈を持っているため、追加の LLM 呼び出し不要で最も精度が高い
- **Trade-offs**: tool の input_schema が少し複雑になるが許容範囲

### Decision: リサーチフェーズの信念生成 LLM は常に Claude Opus

- **Context**: PersonaResearchService でリサーチ結果から initial belief を生成する LLM の選択
- **Alternatives Considered**:
  1. ペルソナの llmType に対応する LLM で生成
  2. 常に Claude Opus
- **Selected Approach**: 常に Claude Opus（既存モデル）
- **Rationale**: 信念生成は構造化された Markdown ドキュメント生成タスクであり、最新情報よりも生成品質が重要。ペルソナの「視点」は検索コンテキストで与えられるため、生成モデルは品質優先でよい
- **Trade-offs**: Gemini/Grok ペルソナでも信念生成は Claude が担うが、実際の「考え方の違い」は討論フェーズで発揮される

---

## Risks & Mitigations

- Vercel AI SDK バージョン固定 — `ai ^4.x` と各 `@ai-sdk/*` のバージョン整合性が壊れるとビルドエラー。peerDependencies を確認してバージョン固定する
- API キー未設定時のフォールバック — `getPersonaModel` で `process.env.*` を確認し、未設定なら claude にフォールバック
- Tavily 検索レート制限（月間クォータ） — ペルソナ数 × 2 クエリ/ペルソナなので通常は許容範囲内
- 既存 `interviewer.ts` テストの削除 — `persona-research.ts` で同等のテストカバレッジを維持

---

## References

- [@tavily/core npm](https://www.npmjs.com/package/@tavily/core)
- [Vercel AI SDK docs](https://sdk.vercel.ai/docs)
- [@ai-sdk/xai npm](https://www.npmjs.com/package/@ai-sdk/xai)
- [xAI Grok API docs](https://docs.x.ai/overview)
- [OpenAI function calling docs](https://platform.openai.com/docs/guides/function-calling)
