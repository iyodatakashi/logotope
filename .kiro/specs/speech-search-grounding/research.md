# Research & Design Decisions

---
**Purpose**: 設計フェーズの調査結果と決定根拠を記録する。

---

## Summary

- **Feature**: `speech-search-grounding`
- **Discovery Scope**: Extension（既存の `PersonaAgentService.generateTurn` への拡張）
- **Key Findings**:
  - Vercel AI SDK v4 の `maxSteps` を使えば、`execute` 付きツール（検索）と `execute` なしツール（submit_turn）を組み合わせてシームレスな agentic ループを実現できる
  - `@ai-sdk/anthropic v1.2.12` には `webSearch_20250305` が存在せず、外部検索 API が必要
  - 現行システムプロンプトの「発言の根拠は個人経験のみ」指示がデータ参照を阻んでいる原因であり、削除・置換が必要

## Research Log

### Vercel AI SDK の multi-step tool call 動作

- **Context**: `generateTurn` を1回の `generateText` 呼び出しで検索+発言生成を完結させたい
- **Sources Consulted**: Vercel AI SDK v4 ドキュメント、`@ai-sdk/anthropic` v1.2.12 型定義
- **Findings**:
  - `generateText({ maxSteps: N })` はステップ間で `execute` 付きツールの結果を自動的に次メッセージとして追加し、LLM を再呼び出しする
  - `execute` を持たないツール（`submit_turn`）を LLM が呼んだ時点でループが自然停止する
  - `toolChoice: 'required'` で強制ツール呼び出しが可能
- **Implications**: 1回の `generateText` 呼び出しで「検索0〜N回 → submit_turn」という流れが実現できる

### @ai-sdk/anthropic の web_search サポート状況

- **Context**: Anthropic ネイティブの `web_search_20250305` ツールを使えるか確認
- **Sources Consulted**: `functions/node_modules/@ai-sdk/anthropic/dist/index.d.mts`
- **Findings**:
  - `anthropic.tools` に含まれるのは `bash_20241022`, `textEditor_20241022`, `computer_20241022` のみ
  - `webSearch_20250305` は **未実装**（v1.2.12 時点）
- **Implications**: 外部検索 API（Brave Search または Tavily）を使ったカスタム実装が必要

### 現行システムプロンプトの制約

- **Context**: なぜペルソナが正確な数値を出せないのかを調査
- **Sources Consulted**: `persona-agent.ts` の `buildPersonaSystemPrompt`
- **Findings**:
  - 「発言の根拠は自分が直接経験したこと・職場で見聞きしたことに限る」という明示的な指示がある
  - `factInstruction` でも「出典・数字は事前取材レコードの範囲にとどめ」と制限している
  - これら2箇所の制限が、検索ツールがあっても使われない原因になりうる
- **Implications**: 検索機能の追加と同時に、システムプロンプトの当該箇所を置換しなければ要件が満たされない

### Firestore ターンデータ構造

- **Context**: 検索記録をどこに保存するか
- **Sources Consulted**: `repository.ts` の `CreateDebateTurnParams`, `createDebateTurn`
- **Findings**:
  - ターンは `topics/{topicId}/sessions/0` の `turns` 配列に `FieldValue.arrayUnion` で追記する
  - 現在のフィールド: `id, turnIndex, speakerType, content, speechMode, engagementScore, fromQueue, addressedPersonaId`
  - 新規フィールドを追加しても既存の `arrayUnion` パターンをそのまま使える（undefined スキップ済みのため）
- **Implications**: `searchUsed?: boolean` と `searchQueries?: string[]` をターンオブジェクトに追加するだけで対応可能

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations |
|--------|-------------|-----------|---------------------|
| **A: maxSteps 統合型** | `web_search`(with execute) + `submit_turn`(no execute) を1回の `generateText` で処理 | 1 LLM コール、自然なアジェンティックループ | `submit_turn` が呼ばれないまま `maxSteps` 枯渇する可能性あり（リトライで対応） |
| B: 2フェーズ分離型 | 検索フェーズ + 発言生成フェーズを別々の `generateText` で実行 | 制御が明確 | 検索不要の場合でも LLM 2回呼び出し（コスト・レイテンシ増） |
| C: Anthropic SDK 直接 | `@anthropic-ai/sdk` を直接使って web_search ネイティブツールを活用 | ネイティブ統合 | Vercel AI SDK パターンとの乖離、モデル切り替え時の互換性低下 |

**選択**: Option A（maxSteps 統合型）

## Design Decisions

### Decision: `toolChoice: 'required'` + `maxSteps` でのアジェンティックループ

- **Context**: 検索を任意で実行しつつ、必ず `submit_turn` で終わる構造が必要
- **Alternatives Considered**:
  1. `toolChoice: 'auto'` — AI がテキストのみで返しうる（submit_turn が呼ばれない）
  2. `toolChoice: 'required'` + `maxSteps: 4` — AI は必ずツールを使い、web_search → ... → submit_turn の順で処理
- **Selected Approach**: `toolChoice: 'required'`, `maxSteps: 4`（検索最大3回 + submit_turn 1回）
- **Rationale**: `submit_turn` は `execute` を持たないため LLM が呼んだ時点でループが止まる。AI はシステムプロンプトの指示に従い、検索が不要なら最初のステップで直接 `submit_turn` を呼ぶ
- **Trade-offs**: `maxSteps` 枯渇リスク → `submit_turn` が見つからない場合は従来の強制 `toolChoice` でリトライ
- **Follow-up**: 実装後にログを確認し、過剰な検索呼び出しがないかモニタリングする

### Decision: 外部検索 API（Tavily or Brave Search）の利用

- **Context**: Anthropic ネイティブ web_search が SDK に未実装
- **Alternatives Considered**:
  1. `@ai-sdk/anthropic` のバージョンアップ — 管理外の変更、リスク高
  2. Tavily API — AI 向けに最適化、クリーンな結果、LangChain など多数の AI フレームワークで採用実績
  3. Brave Search API — 汎用検索、API キーが必要
- **Selected Approach**: Tavily API を推奨（実装時に確定）
- **Rationale**: AI 向けに設計された応答フォーマットで、余計なパースが不要
- **Trade-offs**: 新規 API キーが必要（`TAVILY_API_KEY` 環境変数）

### Decision: `searchEnabled` フラグによる検索有効化制御

- **Context**: 検索は Claude モデルで最も安定して動作する。Gemini・GPT でも動作するか不明
- **Selected Approach**: 検索ツールはすべてのモデルに対して提供するが、`TAVILY_API_KEY` が未設定の場合は `web_search` ツールを含めずフォールバック
- **Rationale**: 検索 API の可用性でグレースフルデグレードが自然に実現できる

## Risks & Mitigations

- **maxSteps 枯渇リスク** — `submit_turn` が見つからない場合は強制 `toolChoice` でリトライ（既存パターンと同一）
- **過剰検索コスト** — システムプロンプトで「検索は1〜2回まで、明確に必要なときのみ」と指示する
- **検索結果の質** — Tavily はスニペット形式で返すため、LLM が直接引用しやすい
- **Firestore ドキュメントサイズ** — `searchQueries` は文字列配列で最大数クエリ。ターン1件あたりの増分は数百バイト以内で問題なし

## References

- Vercel AI SDK `generateText` / `maxSteps` ドキュメント（設計時参照）
- `@ai-sdk/anthropic` v1.2.12 型定義（`functions/node_modules/@ai-sdk/anthropic/dist/index.d.mts`）
- Tavily API ドキュメント（実装時に参照推奨）
