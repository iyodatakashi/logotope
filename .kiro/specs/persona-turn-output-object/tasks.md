# Implementation Plan

- [x] 1. ターン出力スキーマの定義と submit_turn ツールの廃止
- [x] 1.1 ターン出力の Zod スキーマを定義する
  - `content`（必須）・`beliefChangeType`（省略可、enum）・`beliefChangeSummary`（省略可）・`beliefChangeUpdatedBelief`（省略可）・`targetPersonaId`（省略可）の5フィールドを持つ Zod オブジェクトスキーマを `persona-agent.ts` 内に追加する
  - `z.infer<typeof turnOutputSchema>` で型 `TurnOutput` を得られること
  - `import { Output } from 'ai'` をインポートに追加する
  - _Requirements: 2.2_

- [x] 1.2 buildFullTurnTools から submit_turn を削除し、search 不可時に undefined を返す
  - `buildFullTurnTools` の tools オブジェクトから `submit_turn` エントリを完全に削除する
  - `isSearchAvailable()` が false の場合、空オブジェクトではなく `undefined` を返す（search 可能な場合のみ `web_search` を含む Record を返す）
  - 戻り値の型を `Record<string, AnyTool> | undefined` に変更する
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. generateTurn を output.object ベースに移行する
- [x] 2.1 generateText に output.object を追加し toolChoice を削除する
  - `generateText` の呼び出しに `output: Output.object({ schema: turnOutputSchema })` を追加する
  - `toolChoice: 'required'` を削除する（`submit_turn` 強制のために使っていたため不要）
  - `buildFullTurnTools` が `undefined` を返す場合は `tools` と `stopWhen` を渡さないよう、スプレッド構文で条件付きに追加する（`...(tools && { tools, stopWhen: stepCountIs(4) })`）
  - TypeScript の型エラーがないこと
  - _Requirements: 2.1_

- [x] 2.2 フォールバック判定を output.content の有無に切り替える
  - 現行の「`submit_turn` がステップ内に存在するか」という判定を削除する
  - `!fullResult.output?.content` で非 Claude モデルの出力成否を判定するよう変更する
  - 例外 throw 時の Claude フォールバックはそのまま維持する
  - フォールバック後に `output.content` がなければ `ok: false` を返す
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 2.3 結果処理を result.output ベースに変更する
  - `allToolCalls.find(c => c.toolName === 'submit_turn')` によるツール呼び出し検索コードを削除する
  - `fullResult.output` から直接 `content`, `beliefChangeType`, `beliefChangeSummary`, `beliefChangeUpdatedBelief`, `targetPersonaId` を取り出す
  - `web_search` 呼び出しの収集は引き続き `fullResult.steps.flatMap(s => s.toolCalls).filter(c => c.toolName === 'web_search')` で行う
  - `searchQueries` を `PersonaReply` に含める既存の動作を維持する
  - `generateTurn` が `Result<PersonaReply, PipelineError>` を返すこと（戻り値型に変更なし）
  - _Requirements: 2.3, 2.4, 3.1, 3.2_

- [x] 3. テストを移行後の実装に合わせて更新する
  - `vi.mock('ai', ...)` のモックオブジェクトに `Output: { object: vi.fn(() => ({})) }` を追加する
  - `generateText` のモック戻り値を `{ output: { content, ... }, steps: [...] }` の形式に変更する（`interview-agent.test.ts` の `makeGenerateTextResult` パターンを参照）
  - `submit_turn` ツール呼び出しオブジェクト（`{ toolName: 'submit_turn', input: {...} }`）を直接参照するコードをすべて削除する
  - 既存の question モード・opinion モード・formatTurns 呼び出し検証の各テストが引き続きパスすること
  - `pnpm test` または `vitest run` で `persona-agent.test.ts` の全テストが green になること
  - _Requirements: 5.1, 5.2, 5.3_
