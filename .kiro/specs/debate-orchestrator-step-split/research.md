# Research & Design Decisions

## Summary
- **Feature**: `debate-orchestrator-step-split`
- **Discovery Scope**: Extension（既存ファイルの責務分割リファクタリング・統合focus）
- **Key Findings**:
  - `step.ts` の `perform*Step` は「ステップ実行」と「次ステップの決定・enqueue（チェーン駆動）」を兼ねており、これが `debate-orchestrator.ts` ↔ `step.ts` の循環 import の根本原因。handler は「実行結果」のみ返し、次ステップ決定（`decideNextStep` 呼び出し・enqueue）を `advanceDebate` が dispatch した stepKind と結果から行う形に分離すれば、`advanceDebate`・`decideNextStep` を orchestrator に置いたまま依存が一方向化する。
  - 論点（discussionPoint）状態機械（untouched→introduced→addressed の遷移＋永続化）が 3 handler に散在。既存 `queued-intents.ts`（状態遷移＋永続化を 1 モジュールに集約）と同型の `discussion-points.ts` へ集約するのが idiomatic。
  - `executeTurn` の後処理（キュー消化→発言統計→信念変化永続化）が freeze 分岐と通常分岐でコピペ。共通ヘルパーへ括り出す。
  - 契約型 `StepContext`/`StepOutcome`/`ChapterEntry` を `debate.types.ts`（最下層リーフ）へ集約すると、型 import を含めて循環ゼロにできる。

## Research Log

### 循環 import の根本原因分析
- **Context**: 当初の 2 ファイル案（orchestrator=advanceDebate+enqueue+decide / step=perform*）で循環が生じる理由を特定。
- **Sources Consulted**: `functions/src/pipeline/debate/step.ts`（701 行）の全関数の相互参照。
- **Findings**: `advanceDebate(orchestrator) → perform*Step(step) → enqueue*(orchestrator)` という参照経路。`perform*Step` が末尾で `enqueueAfterTurn`/`enqueueChapterEnd`/`resumeFromFresh` を直接呼ぶため、step 層が orchestrator 層へ依存する。`advanceDebate` と `enqueue*` を同居させる限り循環は不可避。
- **Implications**: 循環は「handler が実行と次ステップ駆動を兼ねる」構造の症状。handler から「次ステップ駆動」を剥がせば（command-result）、step → orchestrator の依存が消え、一方向化する。

### 責務混同の棚卸し（step.ts 全体）
- **Context**: 「他に責務を跨いだ処理がないか」を精査。
- **Findings**（5 件検出、本スペックで扱う範囲を A 案に確定）:
  1. 論点状態機械の散在（init/introduced/addressed の遷移＋永続化が 3 handler に分散）→ **本スペックで集約**
  2. 終了判定の分裂（early-end 補正が `performTurnStep` に inline）→ 別スペック `debate-step-concern-separation`
  3. 継続/盛り上がり判定の分裂（`executeTurn` の quietStreak 算出 ↔ `decideNextStep` の earlyEnd 判定）→ 別スペック
  4. `performOpenStep` の章初期化（永続化）＋オープニング生成（AI）の混在 → 別スペック
  5. `executeTurn` の後処理重複（freeze/通常分岐のコピペ）→ **本スペックで共通化**
- **Implications**: A 案（command-result＋#1＋#5）を本スペック、#2/#3/#4 を後続スペックへ分離。本スペックは挙動保存を厳守し差分リスクを抑える。

### 既存 queued-intents.ts のパターン確認
- **Context**: 論点状態の集約先（#1）の構成を、既存の踏襲で決めるため。
- **Sources Consulted**: `queued-intents.ts`（`expireQueuedIntents`・`addQueuedIntents`・`consumeQueuedIntent`・`loadQueuedIntents`）。
- **Findings**: キュー（queued intent）というドメイン状態の遷移と Firestore 永続化を 1 モジュールに集約する確立パターンが既にある。
- **Implications**: 論点も同型の `discussion-points.ts`（遷移: init/introduced/addressed＋永続化: save/delete）に集約すれば、過度な抽象化にならず既存パターンに整合する。

### 型の配置と循環回避
- **Context**: `StepContext` をどこに置くと型 import 循環を避けられるか。
- **Findings**: `StepContext` は `ChapterEntry`（現 `debate-lifecycle.ts`）・`Chapter`・`Persona`・`DebateState` を参照。`ChapterEntry` は利用箇所が 2 ファイルのみ（`debate-lifecycle.ts` 定義・`step.ts`）。`ChapterEntry` を `debate.types.ts` へ移し、`StepContext`/`StepOutcome` も同所に置けば、これらの型モジュールは他 pipeline モジュールに依存しないリーフとなり循環しない（`chapter.types.ts` へ移すと `ChapterEntry → DebateTurn` 経由で `debate.types.ts` との型循環が生じうるため `debate.types.ts` に集約する）。
- **Implications**: 契約型は `debate.types.ts` に集約。`debate-lifecycle.ts` は `ChapterEntry` を `debate.types.ts` から import するよう変更（既に `DebateTurn` を同所から import 済みで整合）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 役割優先 2 分割（当初案） | advanceDebate+enqueue＝orchestrator / perform*＝step | 当初の語感に忠実 | `orchestrator ↔ step` 循環 import | 却下 |
| B. advanceDebate を step.ts へ | 依存方向で切り一方向化（advanceDebate は step 側） | 最小差分・一方向 | advanceDebate が orchestrator に無い語感のズレ | 却下 |
| C. handler が NextStep を返す | handler が decideNextStep を呼ぶ | applyOutcome 不要 | 「次の決定」が step 層に漏れる | 却下 |
| D. 実行と決定の分離（採用） | handler＝実行結果のみ / advanceDebate が stepKind と結果で次を決定し既存 enqueue ヘルパーで投入 | 決定が orchestrator に乗る・一方向・新語彙ゼロ | handler 末尾の enqueue を結果返却へ移す差分（挙動不変） | 採用 |

## Design Decisions

### Decision: 「実行」と「次ステップ決定」を分離（handler＝実行結果 / orchestrator＝決定）
- **Context**: 循環の根本原因は handler が「次ステップ決定・enqueue」まで抱えること。「次に何をするか」はオーケストレーションの責務であり orchestrator が持つべき。
- **Alternatives Considered**:
  1. advanceDebate を step.ts へ移す（依存方向で切るだけ）→ advanceDebate が orchestrator に無い語感のズレ。
  2. handler が enqueue を引数注入（DI）→ コールバック引き回しで可読性低下。
  3. handler が `NextStep` を返す（handler が `decideNextStep` を呼ぶ）→ 「次の決定」が step 層に漏れる。`StepOutcome` 新語彙は既存 `NextStep` と二重化。
  4. handler は「実行結果」のみ返し、`advanceDebate` が dispatch した stepKind と結果から次を決定（`decideNextStep` を呼び enqueue）。
- **Selected Approach**: 4。`perform*Step` は enqueue/`decideNextStep` を呼ばず実行結果のみ返す（turn は `TurnExecution`＝`completed`/`conflict`/`advanced`(quietStreak)、他は committed の真偽値）。`advanceDebate` が停止ゲート→`loadStepContext`→`buildStepOptions`→dispatch→stepKind 別に既存 enqueue ヘルパーを呼ぶ。
- **Rationale**: 「次は何か」の決定が orchestrator に乗り責務が正しい。`decideNextStep` を handler が呼ばないので `step.ts` は `decideNextStep`/enqueue/`loadStepContext` を import せず、依存が完全に一方向（orchestrator → step）。実行結果（`TurnExecution`）は「何が起きたか」であり、`NextStep`（orchestrator が `decideNextStep` で生成）と別概念なので二重語彙にならない。`StepOutcome`/`applyOutcome` 等の新抽象は導入しない（steering 準拠）。
- **Trade-offs**: 各 handler 末尾の enqueue 呼び出しを除去し、結果返却＋`advanceDebate` 側の stepKind 別分岐に移す差分。挙動は保存（enqueue されるタスク・タスクキー・frontier 不変）。
- **Frontier 不変条件（レビュー Issue 2）**: enqueue ヘルパーは handler が `ctx.state` を更新した「後」に呼ばれ、`ctx.state` から `expectedTurnIndex` を算出する。算出式・実行順は旧コードと同一のため frontier は不変。
- **Follow-up**: parity/idempotency テストで enqueue 等価を確認。

### Decision: 契約型を `debate.types.ts` に集約（レビュー Issue 1/3）
- **Context**: `NextStep` は既に `debate.types.ts` に存在。`ChapterEntry` 近傍に類似の `ChapterForFirestore` も存在。
- **Selected Approach**: `StepContext`・`TurnExecution`（新規）・`ChapterEntry`（移動）を `debate.types.ts` に集約。`NextStep` は既存のまま再利用（handler は返さない）。
- **Rationale**: 「次ステップ」を表す型は `NextStep` の 1 系統に保つ。`TurnExecution` は「実行結果」で別概念のため重複しない。
- **Trade-offs**: `ChapterEntry` と `ChapterForFirestore` が同ファイルに並ぶが、本スペックでは統一せず併存（統一は `chapter-type-unification`）。

### Decision: 論点状態を `discussion-points.ts` へ集約（#1）
- **Selected Approach**: 遷移（`initDiscussionPoints`/`markIntroduced`/`markAddressed`）＋永続化（`saveDiscussionPointStatuses`/`deleteDiscussionPointStatuses`）を新規 `discussion-points.ts` に集約。`queued-intents.ts` と同型。
- **Rationale**: 論点ドメインの状態機械が handler に散らばるのを解消。既存パターン踏襲で抽象化過剰にならない。
- **Trade-offs**: 章ステータス永続化 `updateChapterStatus` は論点ではないため `debate-lifecycle.ts` 側へ（当初の lifecycle 一括移動案を分割）。
- **Note**: `addressed` への遷移関数は本スペックで提供するが、「いつ再確認するか（early-end 補正のトリガ）」は別スペック `debate-step-concern-separation` の #2 に残す。

### Decision: `executeTurn` 後処理の共通化（#5）
- **Selected Approach**: freeze 分岐と通常分岐で重複する「キュー消化→発言統計→信念変化永続化」を `step.ts` 内の private ヘルパー（例: `finalizeCommittedTurn`）へ括り出す。
- **Rationale**: 純粋な DRY 化。片方だけ修正する事故を防ぐ。挙動不変。

## Risks & Mitigations
- command-result 化で enqueue 経路を取り違える — parity/idempotency テスト（タスクキー・frontier・Firestore 副作用）で等価を担保。move 以外の挙動変更を差分レビューで排除。
- `discussion-points.ts` への移動でフィールド名/型の取り違え — `tsc` と既存テストで担保。
- 型集約で `import type` 循環 — `debate.types.ts` をリーフに保ち、pipeline モジュールへ依存させない。
- `decide-next-step.test.ts` ほか import パス更新漏れ — 移動と同時更新（要件 6）。

## References
- `functions/src/pipeline/debate/step.ts` — 分割対象（旧 `debate-orchestrator.ts`）
- `functions/src/pipeline/debate/queued-intents.ts` — 論点集約の参照パターン
- `functions/src/pipeline/debate/debate-lifecycle.ts` — 章ライフサイクル層（`updateChapterStatus` 受け入れ・`ChapterEntry` 移動元）
- `.kiro/specs/debate-step-concern-separation/` — 後続スペック（#2/#3/#4）
- `.kiro/specs/chapter-turn-task-decomposition/` — per-turn ステップチェーン設計の前提
