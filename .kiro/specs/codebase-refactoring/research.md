# Research & Design Decisions

## Summary
- **Feature**: `codebase-refactoring`
- **Discovery Scope**: Extension（既存システムの内部品質改善 + 2つの限定的な挙動変更）
- **Key Findings**:
  - ベースラインは全 green（svelte-check 0 エラー / lint 通過 / 272 テスト全成功 / Functions tsc 成功）で、挙動保全の検証基盤は既に存在する
  - 規約違反の分布は偏っており、最大は短縮コールバック引数（約113箇所）と BEM 違反（17/36 コンポーネント）。`any`・テスト配置はほぼ準拠済み
  - 世代照合（R9）に必要なインフラは実装済み: topic doc に `runId` フィールド、全ステップ payload に `runId: string`（必須）、`addTurn` に後方互換付き世代照合トランザクション。欠けているのは「入口ゲート」と「棄却理由の伝播」のみ
  - 章FC削除（R8）の境界は明確: インラインFCが依存するのは `checkContent`・`fact-check-judge`・`fact-check.types` のみ。`checkChapter`/`checkTurn`・`fact-check-repository`・`api/fact-check.ts` は章FC専用

## Research Log

### 現状ギャップの全数調査
- **Context**: リファクタリング対象の違反量・分布の確定
- **Sources Consulted**: gap-analysis.md（機械 grep + BEM/デッドコード/配置の判読監査）
- **Findings**: gap-analysis.md §2 参照。デッドコード確度高4ファイル、変換関数違反1件、日付フォーマット重複1組
- **Implications**: 作業は「少数の大きな塊（BEM・短縮名）+ 多数の小さな確定修正」。Effort M

### チェーン構造レビュー
- **Context**: ユーザー要望「ロジックレベル・チェーン構造レベルの問題検出」
- **Sources Consulted**: chain-structure-findings.md（討論/生成/編集の3系統レビュー）
- **Findings**: 高5件を含む約25件。うち C-1/C-4 は章FC削除（R8）、A-1 は世代照合（R9）として本 spec で対応確定
- **Implications**: 挙動保全内の整理（A-3, A-6, A-7, A-8, B-4 死にパラメータ, B-9）を通読トラックに取り込む（Decision D4）

### R9: 世代照合の既存インフラ
- **Context**: A-1 修正の設計に必要な事実確認
- **Sources Consulted**: `functions/src/types/step.types.ts:10`、`functions/src/api/debates.ts:22-84`、`functions/src/pipeline/debate/turn.ts:57-74`
- **Findings**:
  - `DebateStepPayload.runId: string` は必須フィールド。start/restart 時に `updateDebatePhaseStatus`/`restartDebateFromChapter` が新 runId を発行し topic doc に保存
  - `addTurn` はトランザクション内で「payload と topic doc 双方に runId がある場合のみ照合」する後方互換ガードを既に持つ
  - `advanceDebate` の入口ゲートは `isDebateActive`（topic doc 読み）のみで runId を見ていない
  - `generatePersonaTurn` が `AppendResult.reason`（`generation_mismatch` | `index_mismatch`）を null に潰し、`performTurnStep` は一律 `'conflict'`、orchestrator は一律 `resumeFromFresh`
- **Implications**: 入口ゲートは既存の topic doc 読みに相乗りでき追加読み取りゼロ。理由伝播は戻り値型の判別可能ユニオン化のみで実現できる

### R8: 章FC削除の境界
- **Context**: インラインFCを壊さない削除範囲の確定
- **Sources Consulted**: import グラフの grep（`inline-fact-check.ts` は `checkContent` のみ import。`checkTurn`/`checkChapter` の参照元は章FC系のみ）
- **Findings**:
  - **削除**: `functions/src/api/fact-check.ts`、`index.ts` の export 2件、`fact-check-runner.ts` の `checkTurn`/`checkChapter`/`OnTurnFindings`、`fact-check-repository.ts` 全体、`debate-lifecycle.ts` の `deleteFactCheckResult` import・呼び出し、FE `stores/factCheck.svelte.ts`、`FactCheckFindings.svelte`、`currentTopic.svelte.ts` の factCheckStore 配線、`Phase5Debate.svelte`/`Phase6Editing.svelte` の章FC表示・突合、`firestore.rules` の factCheck match、対応テスト（`fact-check-repository.test.ts`、`FactCheckFindings.svelte.spec.ts`、`stores/factCheck.test.ts`、`fact-check-runner.test.ts` の章FC部分ほか）
  - **維持**: `fact-check-runner.ts` の `checkContent`、`fact-check-judge.ts`（correction-worthiness）、`types/fact-check.types.ts`、`inline-fact-check.ts`、`turn.types.ts` の factCheck 埋め込み型（FE/BE とも。Firestore 永続形のミラーであり削除不可）、編集の保護判定 `computeProtectedTurnIds`
  - **注意**: FE `models/factCheck/factCheck.types.ts` は「結果ドキュメント型（削除）」と「finding 型（turn 埋め込みミラーとして維持の可能性）」が同居。turn.types.ts からの参照を確認して finding 型のみ残すか移動する
- **Implications**: 削除は機械的に安全。唯一の判断点は FE finding 型の残し方（実装時に参照を確認）

### dayjs 導入
- **Context**: R4.4 日付整形の統一
- **Sources Consulted**: `npm view dayjs version` → **1.11.21**（最新安定）
- **Findings**: フロント・functions とも未導入。置き換え対象3箇所。functions 側は `format('YYYY年M月D日')` で現行出力と完全一致。FE `TopicListItem.svelte` の `toLocaleDateString('ja-JP', {year:'numeric', month:'long', day:'numeric'})` は「2026年7月6日」形式 → dayjs `format('YYYY年M月D日')` と一致する（実装時にテストで確認）
- **Implications**: 両 package.json に `dayjs@^1.11.21` を追加。ロケールファイル不要（数値ベースのフォーマットのみ）

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 規約領域別スイープ | ルールごとに全体一括 | 機械的・検証しやすい | 同一ファイルを反復訪問、通読系と不整合 | |
| B: モジュール別 | ディレクトリごとに全規約 | 1回の通読で完結 | 進捗可視性低、機械置換が通読に巻き込まれる | |
| **C: ハイブリッド（採用）** | 機械的スイープ + 通読トラック + BEM 独立トラック | 作業性質に適合、R7 検出が通読に自然に載る | トラック管理が必要（tasks.md で吸収） | gap-analysis §4 |

## Design Decisions

### Decision: D1 — Firestore 書き込み・callable の置き場所基準（解決済み・ユーザー決定）
- **Selected Approach**: 「操作が属するエンティティの状態管理（シングルトン store / createXXX インスタンス）に置く」。現配置は基準どおりでコード移動なし
- **Rationale**: models の createXXX と stores はインスタンス/シングルトンの違いでしかなく、置き場所は操作の性質で決まる
- **Follow-up**: UI コンポーネントからの直接呼び出しが無いことの確認のみ実装時に行う

### Decision: D2 — BEM は全 17 ファイルを対象とする
- **Alternatives**: 全件 / 軽微違反（B・C・D グループ）のみ先行
- **Selected Approach**: 全件。ただし A グループ（BEM 未導入 9 ファイル）は独立タスクに分割し、1ファイル=1確認単位で進める
- **Trade-offs**: 見た目回帰の目視確認コスト vs 規約の完全準拠。scoped CSS のため class 属性と style の同期改名を機械的に行えばリスクは限定的

### Decision: D3 — 未使用資産の削除範囲
- **Selected Approach**: R4.2 の文言どおり「どこからも参照されていない」export・ファイルを削除（確度高4ファイル + 未使用型 export）。テストから参照される本番未使用関数（`setTopicPhaseStatus` 等）は「参照あり」として残す（将来の B-2 対応で使用予定の移行証跡でもある）。`readFactCheckResult` は章FC削除で消える。`src/tests/models/session/` は旧スキーマの名残として削除
- **Follow-up**: 削除前に最終参照チェックを行い、削除一覧を実装ログに残す

### Decision: D4 — チェーン整理の取り込み範囲
- **Selected Approach**: 挙動保全内の所見（A-3 早期終了判定の一本化、A-6 finalResponse 分散の整理、A-7 StepContext 組成の一本化とエイリアス削除、A-8 死んだ分岐・同名別物 rename・フォールバック必須引数化、B-4 死にパラメータ topicContext の FE 側削除、B-9 Result 型への統一）を本 spec の通読トラックに含める。**A-2/C-5（Firestore 読み取り重複の解消）は R1.4 に照らして先送り**（IO パターン変更は専用の検証を伴う別 spec が適切）
- **Trade-offs**: 通読トラックの作業量増 vs チェーン可読性の即時改善

### Decision: D5 — 挙動変更系チェーン問題の扱い
- **Selected Approach**: C-1/C-4 は R8、A-1 は R9 として本 spec で対応。残り（B-1/B-2/B-3/B-5/B-6 の生成ライフサイクルサーバ一本化、A-4, A-5, B-7, C-2, C-3, B-8, A-9）は R7 レポートに載せ、本 spec 完了後の別 spec 化を推奨

### Decision: R9 の実現形 — 入口ゲート + 理由伝播（新規結合なし）
- **Context**: 旧世代タスクの LLM 実行と副作用を止める
- **Alternatives Considered**:
  1. 入口ゲートのみ — 実装最小だが、ゲート通過後に restart された場合の LLM 浪費が残る
  2. 入口ゲート + addTurn 理由伝播（採用）— ゲートで大半を止め、すり抜けた世代交代はトランザクション照合が検出し resume を止める
- **Selected Approach**: `advanceDebate` 冒頭の既存 topic doc 読みに runId 照合を追加（追加読み取りゼロ）。`generatePersonaTurn` → `performTurnStep` → orchestrator の戻り値を判別可能ユニオンにし、`generation_mismatch` は再エンキューせず終了、`index_mismatch` は従来どおり `resumeFromFresh`
- **Rationale**: addTurn の照合はセーフティネットとして既に存在。設計済みの区別を捨てている搬送経路を直すだけで、新しい仕組みを導入しない
- **Follow-up**: summary/closing/comments ステップが入口ゲートで守られることのテスト。旧世代タスクは「正常終了」で ack し Cloud Tasks リトライを発生させないこと

## Risks & Mitigations
- BEM 改名の見た目回帰 — class 属性と `<style>` の同期改名を1ファイル単位で実施し、`pnpm check`（svelte-check の未使用セレクタ警告）+ 画面目視で確認
- 短縮名の一括改名によるシャドーイング・誤置換 — ファイル単位で lint + テストを回す。機械置換でなく LSP リネームに準じた単位で行う
- 章FC削除の消し過ぎ（インラインFC破壊） — 削除境界は本 research の「維持」リストに固定。削除後に `inline-fact-check.flow.test.ts` 等の維持対象テストが green であることを確認
- R9 の理由伝播で戻り値型が変わる — 討論チェーンの既存テスト（turn.test.ts ほか）の追従は「振る舞い変更」ではなく型追従に限定されることをレビューで確認

## References
- [gap-analysis.md](gap-analysis.md) — 全数調査結果と要判断事項
- [chain-structure-findings.md](chain-structure-findings.md) — チェーン構造所見（A/B/C 系）
- dayjs 1.11.21 — https://day.js.org/ （フォーマットトークン `YYYY年M月D日`）
