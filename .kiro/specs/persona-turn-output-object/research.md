# Research & Design Decisions

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the technical design.

---

## Summary

- **Feature**: `persona-turn-output-object`
- **Discovery Scope**: Extension（既存エージェントのアウトプット取得方式の変更）
- **Key Findings**:
  - `interview-agent.ts` が `Output.object({ schema })` + `generateText` の参照実装として利用可能
  - `toolChoice: 'required'` は `submit_turn` に依存しているため、移行後は削除が必要
  - `web_search` が利用不可の場合に `tools` を渡さない条件分岐が必要（空オブジェクト禁止）

## Research Log

### Output.object の API 確認

- **Context**: AI SDK v6 で `generateText` + `output` を同時に使う方法の確認
- **Sources Consulted**: `functions/node_modules/ai/dist/index.d.ts`、`interview-agent.ts`
- **Findings**:
  - `Output` は `ai` から名前付きエクスポートされる（`output as Output`）
  - `Output.object({ schema: ZodSchema })` でオブジェクト型出力を定義
  - `result.output` でスキーマ型に従った結果を取得（型は `unknown` → キャスト不要な `InferCompleteOutput<OUTPUT>` 型）
- **Implications**: `interview-agent.ts` と同一パターンで実装可能

### toolChoice: 'required' の役割

- **Context**: 現行コードが `toolChoice: 'required'` を指定している理由の分析
- **Findings**:
  - `submit_turn` をモデルに必ず呼ばせるための強制指定
  - `output.object` 移行後はモデルが最終ステップで構造化出力を返すため不要
  - `toolChoice: 'required'` を残すと、`web_search` が唯一のツールになったとき必ず検索を強制してしまう
- **Implications**: `toolChoice: 'required'` を削除し、`web_search` はモデルが自由に呼べるよう `'auto'`（デフォルト）にする

### tools が空の場合の扱い

- **Context**: `isSearchAvailable()` が false の場合、`web_search` が存在しない
- **Findings**:
  - 空の `tools: {}` を渡すと SDK が警告またはエラーを出す可能性がある
  - `tools` を省略（`undefined`）した場合、`stopWhen: stepCountIs(4)` は効果を持たない（ツール呼び出しなしで即終了）
- **Implications**: `isSearchAvailable()` が false の場合は `tools` と `stopWhen` を両方省略する

### フォールバック判定の変更

- **Context**: 現行のフォールバック判定は「`submit_turn` が steps 内に存在するか」
- **Findings**:
  - `output.object` 移行後は `result.output.content` の存在で判定可能
  - 空文字列（`''`）は falsy なので `!result.output?.content` で十分
- **Implications**: フォールバック判定を `result.output?.content` に切り替える

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations |
|--------|-------------|-----------|---------------------|
| `output.object` + `generateText` | SDK v6 標準の構造化出力 | ツール＋構造化出力を1コールで実現、型安全 | `Output.object` の型推論が `unknown` になりうる（キャスト必要） |
| 2段階（`generateText` → `generateObject`） | 検索後に別コールで構造化 | シンプル | API 2回呼び出し、コスト増 |
| `submit_turn` ダミーツール（現行） | ツール引数として構造化データを渡す | 既存動作 | ツール呼び忘れエラーリスク、ステップ消費 |

## Design Decisions

### Decision: `toolChoice` の削除

- **Context**: `toolChoice: 'required'` を残すと `web_search` が唯一のツールになった際、モデルが必ず検索を実行してしまう
- **Alternatives Considered**:
  1. `toolChoice: 'auto'` を明示指定
  2. `toolChoice` を省略（デフォルトが `'auto'`）
- **Selected Approach**: `toolChoice` を省略する
- **Rationale**: AI SDK のデフォルトが `'auto'` であり、明示的に書く意味がない
- **Trade-offs**: モデルが検索を使わない可能性があるが、それが正しい動作

### Decision: tools の条件付き渡し

- **Context**: 検索不可時に空 `tools: {}` を渡すのは不適切
- **Selected Approach**: `isSearchAvailable()` が false の場合は `tools` と `stopWhen` をスプレッド構文で条件付き追加
- **Rationale**: `interview-agent.ts` の `tools` は常に存在するが、`persona-agent.ts` は検索可否に依存する

## Risks & Mitigations

- `result.output` の型が `unknown` になる場合 → Zod スキーマから `z.infer<typeof turnOutputSchema>` でキャスト
- `toolChoice: 'required'` 削除によるモデルの挙動変化 → フォールバック（Claude）が引き続き保護する
- テスト側で `Output` モックが不完全な場合にテストが落ちる → `interview-agent.test.ts` の `Output` モックパターンをそのまま流用する
