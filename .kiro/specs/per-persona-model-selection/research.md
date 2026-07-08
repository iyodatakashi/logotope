# Research & Design Decisions: per-persona-model-selection

## Summary
- **Feature**: per-persona-model-selection
- **Discovery Scope**: Extension（既存機構の撤去・置換・モデル定数更新）
- **Key Findings**:
  - `llmType` 機構は少数の中核ファイルに集中。フロント型に宣言はあるが UI では読み書きゼロ（型削除のみで済む）。
  - OpenAI 呼び出しは `functions/src/llm/models.ts` の2経路（gpt ペルソナ・`personaGenerator`）のみ。両方 Claude 化で `@ai-sdk/openai` と全 `OPENAI_API_KEY` シークレットを撤去可能。
  - `generateImpression` はエラー Result を返す try/catch を持つ。「エラーハンドリング無し」ではなく「claude フォールバックが無い」だけ。gpt→openai クォータ失敗が根本原因で、単一モデル化により消滅する。

## Research Log

### `claude-sonnet-5` の可用性と AI SDK 互換
- **Context**: `AI_MODELS.SONNET` を `claude-sonnet-4-6` → `claude-sonnet-5` に更新（R5）。実行時にモデルが解決されるか。
- **Sources Consulted**: claude-api スキル（Anthropic 公式モデルカタログ）、ローカル `node_modules/@ai-sdk/anthropic@3.0.85` の `dist/index.d.ts` 型定義。
- **Findings**:
  - `claude-sonnet-5`（Claude Sonnet 5）は現行の最新 Sonnet。1M コンテキスト、128K 出力。
  - `@ai-sdk/anthropic@3.0.85` の `AnthropicMessagesModelId` union は `claude-sonnet-5` を**明示列挙していない**が、末尾に `(string & {})` を含むため任意文字列を受け付け、TS コンパイルは通過し API へそのまま渡る。
  - Sonnet 4.6→5 は新トークナイザで同一テキストのトークン数が増える（コスト特性が変化）。adaptive thinking の既定挙動も変わりうるが、AI SDK 抽象化により本コードの `generateText`/`generateObject` 呼び出しシグネチャは不変。
- **Implications**: 型面の障害はない。実行時解決はエミュレータ未使用方針（steering `no-emulator`）のため本番デプロイでのスモーク検証が必須。バージョン更新は必須ではないが、将来的に union へ明示追加された版へ上げるのも選択肢。

### OpenAI 依存の全経路
- **Context**: R4.3「ペルソナ関連経路が `OPENAI_API_KEY` に依存しない状態」の実現範囲。
- **Sources Consulted**: `grep` による `openai(`・`OPENAI_API_KEY`・`@ai-sdk/openai` の全件調査。
- **Findings**:
  - `openai()` 呼び出しは `models.ts` の①`providerForModel`（gpt ペルソナ）②`getPipelineModel` の `personaGenerator` case の2箇所のみ。
  - `OPENAI_API_KEY` は `index.ts` と 7 つの API ファイル（debates/stakeholders/interviews/fact-research/chapters/personas/editing）の SECRETS 配列に定義。
  - ①は `llmType` 撤去、②は Claude 化で両方消え、`@ai-sdk/openai` import と依存、全 SECRETS の `OPENAI_API_KEY` が撤去可能。
- **Implications**: OpenAI 痕跡ゼロを達成できる。Cloud Functions の secret 定義変更を伴うためデプロイ影響に注意。

### フォールバック・失敗時挙動の現状
- **Context**: R3（単一プロバイダ化後の失敗時挙動）の目標形。
- **Sources Consulted**: `persona-agent.ts` の `generatePersonaTurn`(308-333) と `generateImpression`(474-493)。
- **Findings**:
  - 発言経路: `try { getPersonaModel(llmType) } catch { getPersonaModel('claude') }` + 空出力時も claude 再試行。単一モデル化後は「claude→claude」で自明に冗長。
  - 所感経路: try/catch でエラー Result を返す。フォールバック分岐は元々持たない。
  - 単一モデル化により、両経路とも別プロバイダ分岐が消え、失敗時は「エラー Result を上位へ返す」に統一される。AI SDK 内蔵リトライが一過性失敗を吸収する。
- **Implications**: R3 は「冗長フォールバック分岐の削除 + 失敗時はエラー Result を明示的に返す」で充足。所感側に新規リトライ機構を足す必要はない（根本原因である gpt 経路が消えるため）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 最小撤去 | 機構削除＋定数更新のみ | 変更最小 | OpenAI 痕跡・冗長分岐が残存 | R3/R4 を完全充足しない |
| B: 完全撤去 | A＋OpenAI 痕跡ゼロ＋失敗時挙動統一 | 要件完全充足 | 触るファイル増（SECRETS 8） | **採用** |
| C: 段階デプロイ | B を2フェーズ | Sonnet5 検証を分離 | 2回デプロイ | B のコミット/デプロイ運用として採用 |

## Design Decisions

### Decision: モデル定数の一元管理で最新化を波及させる
- **Context**: R5 の Sonnet 最新化を全エージェントへ一律適用。
- **Alternatives Considered**:
  1. 各エージェントのモデル指定を個別に書き換え
  2. `AI_MODELS.SONNET` 定数1箇所を更新し、ペルソナ経路も同定数を参照させる
- **Selected Approach**: 2。`AI_MODELS.SONNET = 'claude-sonnet-5'` に更新。ペルソナ経路は `getPersonaModel` 撤去後 `anthropic(AI_MODELS.SONNET)` を直接使用させ、Sonnet 参照を単一定数に集約。
- **Rationale**: 既存の定数集約パターン（`ai.constants.ts`）に沿い、将来のモデル更新も1箇所で済む。
- **Trade-offs**: ✅ 波及が自動・一貫 / ❌ 定数変更が広範囲に影響するため回帰テスト必須。
- **Follow-up**: 全 Sonnet 利用エージェントのテストが新モデルで通ること、デプロイ後スモーク。

### Decision: PERSONA_MODELS と providerForporter 分岐の全撤去
- **Context**: R2。`llmType` → 実モデル解決層をどこまで消すか。
- **Alternatives Considered**:
  1. `PERSONA_MODELS` を `claude` のみに縮退して残す
  2. `getPersonaModel`・`providerForModel`・`PERSONA_MODELS` を撤去し、ペルソナ経路が `anthropic(AI_MODELS.SONNET)` を直接使う
- **Selected Approach**: 2。ペルソナ人格ごとの解決層自体を撤去。`getPipelineModel` の Gemini 系はプロバイダ選択を独自に持つため影響なし。
- **Rationale**: 形骸化した中間層を残すと再び形骸化を招く。[[feedback-no-reexport-shortcuts]] に沿い参照側を直接書き換える。
- **Trade-offs**: ✅ 中間層消滅で単純化 / ❌ `getPersonaModel` をモックする複数テストの書き換えが必要。
- **Follow-up**: `models.test.ts` の gemini/gpt 分岐テスト、`persona-agent.test.ts` の gpt/gemini ペルソナテスト、`debate-cost-reduction.test.ts` のモックを整理。

### Decision: Sonnet 5 の thinking 挙動を 4.6 に合わせる（thinking 無効を中央注入）
- **Context**: R5 の Sonnet 4.6→5 更新。Sonnet 5 は「`thinking` 省略時に adaptive thinking が既定オン」（4.6 は省略時オフ）。ユーザー方針は「まず 4.6 挙動を保つ」。全 Sonnet 利用エージェント（討論・章生成・編集）のコスト/レイテンシ増を避ける。
- **Sources Consulted**: claude-api スキル（Sonnet 5 移行ガイド: 省略時 adaptive／`{type:'disabled'}` 受理）、ローカル `@ai-sdk/anthropic@3.0.85`（`providerOptions.anthropic.thinking` に `'adaptive'|'enabled'|'disabled'` の discriminated union、省略時は無送信）、`ai@6`（`wrapLanguageModel` + `defaultSettingsMiddleware` をエクスポート）。
- **Alternatives Considered**:
  1. 各 Sonnet 呼び出し（約18箇所）に `providerOptions: { anthropic: { thinking: { type: 'disabled' } } }` を個別付与
  2. `llm/models.ts` で共有ラップモデル `sonnet` を定義し（`wrapLanguageModel` + `defaultSettingsMiddleware` で thinking 無効を注入）、全エージェントがこれを使用
- **Selected Approach**: 2。`export const sonnet = wrapLanguageModel({ model: anthropic(AI_MODELS.SONNET), middleware: defaultSettingsMiddleware({ settings: { providerOptions: { anthropic: { thinking: { type: 'disabled' } } } } }) })` を1箇所定義。ペルソナ経路・全 Sonnet 利用エージェント・`getPipelineModel('personaGenerator')` がこの `sonnet` を使う。
- **Rationale**: thinking 無効の定義を1箇所に集約でき、18箇所の個別付与の付け漏れリスクを排除。モデル ID とモデル既定オプションの真実源が一致する。message レベルの `cacheControl`（`PERSONA_CACHE_PROVIDER_OPTIONS`）とは別レイヤのため共存する。
- **Trade-offs**: ✅ 単一定義で全経路に適用・付け漏れ無し / ❌ ラップモデルという小さな間接が増える（over-abstraction ではなく横断的モデル設定の集約）。
- **Follow-up**: デプロイ後、`usage` に reasoning/thinking トークンが計上されないこと（thinking オフ）を chapter/facilitator/editing も含めて確認。将来 adaptive を有効化する場合はこの1箇所を変更するだけで済む。

### Decision: personaGenerator を getPipelineModel から独立させるか
- **Context**: R4。`personaGenerator` を Claude 化。
- **Alternatives Considered**:
  1. `getPipelineModel` の `personaGenerator` case を `anthropic(AI_MODELS.SONNET)` に置換して残す
  2. `personaGenerator` を `PIPELINE_MODELS` から外し、呼び出し側が直接 `anthropic(AI_MODELS.SONNET)` を使う
- **Selected Approach**: 1。`getPipelineModel` の該当 case を Claude に置換し、`PIPELINE_MODELS.personaGenerator` を `claude-sonnet-5` に更新。既存の呼び出し（`persona-generator-agent.ts:49`）を変えずに済む。
- **Rationale**: 呼び出し側の変更を最小化し、パイプラインモデルの一覧性を保つ。
- **Trade-offs**: ✅ 呼び出し側不変 / ❌ `PIPELINE_MODELS` に Claude が混じる（一覧上は許容）。
- **Follow-up**: `models.test.ts` の personaGenerator が openai でなく anthropic を呼ぶことの検証へ更新。

## Risks & Mitigations
- **`claude-sonnet-5` 実行時解決**（主リスク）— 型は通るが AI SDK union 未掲載。ミティゲーション: コミット/デプロイを C 的に分割し、「機構撤去＋Sonnet5化」を先にデプロイしてスモーク検証してから OpenAI 撤去へ進む。
- **Sonnet 4.6→5 の thinking 既定変化** — 省略時 adaptive オンで全 Sonnet 経路のコスト/レイテンシ増。ミティゲーション: 共有 `sonnet` ラップモデルで thinking 無効を注入し 4.6 挙動を維持（上記 Decision）。Phase1 検証で chapter/facilitator/editing も含め thinking トークン非計上を確認。
- **Sonnet 4.6→5 のトークナイザ変化** — 新トークナイザで入力トークン増（thinking 無効でも入力側は増える）。ミティゲーション: デプロイ後に生成コストを観察（要件外の運用判断として記録）。
- **テスト広域改修による回帰** — `llmType` fixture・モックが約15ファイル。ミティゲーション: fixture から `llmType` を除去し、`getPersonaModel` 依存モックを撤去。`pnpm test:unit` 全通過を完了条件に含める。
- **OPENAI_API_KEY 撤去のデプロイ影響** — secret 定義変更。ミティゲーション: ペルソナ以外に OpenAI 利用が無いことを最終 grep で確認してから撤去。

## References
- claude-api スキル（Anthropic 公式モデルカタログ・移行ガイド）— `claude-sonnet-5` の可用性・トークナイザ変更の根拠
- `node_modules/@ai-sdk/anthropic@3.0.85/dist/index.d.ts` — モデル ID 型 union の確認
- [[project-persona-model-consolidate-claude]] — 本 spec の決定記録
- [[feedback-no-reexport-shortcuts]] — 撤去時の直接書き換え方針
