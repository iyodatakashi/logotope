# Requirements Document

## Project Description (Input)
肥大化した `functions/src/pipeline/debate/step.ts`（旧 debate-orchestrator.ts、約700行）を、責務ごとに分離する挙動保存リファクタリング。

当初は「全体オーケストレーション」と「step ごとの処理」の 2 ファイル分割を想定したが、コードを精査した結果、複数の責務混同が判明した。これらを構造整理で解消する。

1. **実行と次ステップ決定の混同**: 各 step 処理（`perform*Step`）が「自分の仕事の実行」と「次ステップの決定・enqueue（チェーン駆動）」を兼ねており、素朴に切ると `advanceDebate → perform*Step → enqueue*` の循環 import が生じる。→ **実行と決定を分離**する。`perform*Step` は自分のステップの「実行結果」だけを返し、「次に何をするか」の決定（`decideNextStep` 呼び出しと enqueue）は orchestrator（`advanceDebate`）が dispatch した stepKind と実行結果から行う。これにより handler は `decideNextStep`/enqueue 系へ依存せず、`advanceDebate` を orchestrator に置いたまま依存が一方向になる。
2. **論点（discussionPoint）状態機械の散在**: untouched→introduced→addressed の遷移と永続化が 3 つの handler に分散している。→ 既存 `queued-intents.ts` と同じパターンで新規 `discussion-points.ts` に集約する。
3. **ターン後処理の重複**: `executeTurn` の freeze 分岐と通常分岐で「キュー消化→発言統計→信念変化永続化」がコピペされている。→ 共通ヘルパーに括り出す。

公開 API（`advanceDebate` / `decideNextStep` / `DEFAULT_OPTIONS`）の挙動・シグネチャは不変。既存テスト（debate-parity / debate-step-idempotency / decide-next-step）はアサーションを変えず import パス更新のみで通過させる。

（本スペックで見送る責務混同: 「終了判定の補正（early-end カバレッジ再確認）」と「継続/盛り上がり判定（quietStreak）」の集約は別スペックへ。論点状態の `addressed` への in-memory 遷移は集約するが、再確認のトリガ判断自体は performTurnStep に残す。）

## Introduction

本仕様は、討論パイプラインの中核ファイル `functions/src/pipeline/debate/step.ts` を、責務の異なる層へ整理する挙動保存リファクタリングを定義する。整理後の構成は次のとおり。

- `debate-orchestrator.ts`（新規・チェーン駆動）: `advanceDebate`（dispatch＋次ステップ決定）・`loadStepContext`・`decideNextStep`・`enqueue*`・`resumeFromFresh`・実行オプション。
- `step.ts`（ステップ実行）: `perform*Step`（実行結果を返す）・`executeTurn`・ターン後処理ヘルパー・step ローカルの純ヘルパー。
- `discussion-points.ts`（新規・論点状態）: 論点の状態遷移（init/introduced/addressed）と永続化。
- `debate-lifecycle.ts`（既存・章ライフサイクル）: 章ステータス永続化ヘルパーを受け入れる。
- `debate.types.ts`（既存・契約型）: `StepContext`・`StepOutcome`・`ChapterEntry` を集約。

本リファクタリングは外部から観測可能な振る舞い（生成・追記・enqueue されるタスク・戻り値）を一切変えない。

## Boundary Context

- **In scope**:
  - `step.ts` 内の関数・型・定数を、責務に基づいて `debate-orchestrator.ts`（新規）・`step.ts`・`discussion-points.ts`（新規）・`debate-lifecycle.ts`・`debate.types.ts` へ再配置する
  - 各 `perform*Step` を「enqueue/`decideNextStep` を直接呼ぶ」形から「実行結果のみ返す」形へ変更し、次ステップの決定・enqueue を `advanceDebate`（orchestrator）に集約する
  - 論点状態の遷移（`initDiscussionPoints`／`markIntroduced`／`markAddressed`）と永続化（`saveDiscussionPointStatuses`／`deleteDiscussionPointStatuses`）を `discussion-points.ts` に集約する
  - 章ステータス永続化ヘルパー（`updateChapterStatus`）を `debate-lifecycle.ts` へ移動する
  - `executeTurn` の重複後処理（キュー消化→発言統計→信念変化永続化）を共通ヘルパーへ括り出す
  - 契約型 `StepContext`・`TurnExecution`（新規）・`ChapterEntry`（移動）を `debate.types.ts` へ集約する
  - 移動に伴う各ファイル間および利用側（`api/debates.ts`・該当テスト）の import 経路の更新
- **Out of scope**:
  - アルゴリズム・判定規則・パフォーマンスの変更（`decideNextStep` の規則、frontier 競合解決、冪等性ロジック、カバレッジ再確認の発火条件等は不変）
  - 「終了判定の補正」と「継続/盛り上がり判定（quietStreak）」の集約（別スペックへ）
  - 公開 API（`advanceDebate` / `decideNextStep` / `DEFAULT_OPTIONS`）のシグネチャ・引数・戻り値の変更
  - 既存テストのアサーション・期待値・モックの変更（import パスのみ更新可）
  - `debate-lifecycle.ts` の既存関数や `turn.ts`・`engagement.ts`・`debate-state.ts`・`turn-step-task.ts` の内部変更
  - `ChapterEntry` 自体のスキーマ変更（命名統一は別 spec `chapter-type-unification` の領域）
- **Adjacent expectations**:
  - `api/debates.ts` の `onTaskDispatched` ハンドラは引き続き `advanceDebate` を同一シグネチャで呼び出せる
  - `turn-step-task.ts`（`enqueueTurnStep` / `taskKey`）との連携インターフェースは不変
  - enqueue されるタスク（stepKind・frontier・タスクキー）は分割前と同一
  - 既存 spec `debate-orchestrator-cleanup`・`chapter-turn-task-decomposition` で確立した per-turn ステップチェーン設計を踏襲する
  - 新規 `discussion-points.ts` は既存 `queued-intents.ts`（状態遷移＋永続化を 1 モジュールに集約）と同じ構成パターンに揃える

## Requirements

### Requirement 1: 責務に基づく層分割
**Objective:** 開発者として、チェーン駆動・ステップ実行・論点状態・章永続化・契約型がそれぞれ別ファイルに分かれていてほしい。そうすれば各層を独立して読み書きでき、ファイル肥大化による認知負荷が下がる。

#### Acceptance Criteria
1. The Debate Pipeline shall place チェーン駆動の責務（`advanceDebate`・`loadStepContext`・`getTopicContext`・`decideNextStep`・`hasUnansweredTargetAtEnd`・`enqueueStep`・`enqueueAfterTurn`・`enqueueChapterEnd`・`resumeFromFresh`・`DEFAULT_OPTIONS`・`buildStepOptions`）を `debate-orchestrator.ts` に配置する.
2. The Debate Pipeline shall place ステップ実行の責務（`performOpenStep`・`performTurnStep`・`performSummaryStep`・`performClosingStep`・`performCommentsStep`・`executeTurn`・`getLastTargetPersona`）を `step.ts` に配置する.
3. The Debate Pipeline shall place 章ステータス永続化ヘルパー（`updateChapterStatus`）を `debate-lifecycle.ts` に配置する.
4. The Debate Pipeline shall move 契約型（`StepContext`・`TurnExecution`・`ChapterEntry`）を `debate.types.ts` に配置する.
5. Where ある補助関数が単一の層からのみ使用される場合, the Debate Pipeline shall その関数を当該層のファイルに同居させる.
6. Where 各ファイルへの分割後にファイル冒頭の説明コメントが実態と乖離する場合, the Debate Pipeline shall 各ファイルの責務を説明するコメントへ更新する.

### Requirement 2: 実行と次ステップ決定の分離
**Objective:** 開発者として、各 step 処理は「自分のステップの実行」だけを行い、「次に何をするか」の決定（`decideNextStep` の呼び出しと enqueue）は orchestrator が持つ形にしてほしい。そうすれば責務が正しい層に乗り、step 層がチェーン駆動層に依存せず、循環なく `advanceDebate` を orchestrator に置ける。

#### Acceptance Criteria
1. The Debate Pipeline shall change 各 `perform*Step` を, enqueue/`decideNextStep`/`resumeFromFresh` を呼ばず, 自分のステップの「実行結果」のみを返す形にする（turn は `TurnExecution`＝`completed`/`conflict`/`advanced`(quietStreak) の判別共用体、その他は committed の真偽値）.
2. When `advanceDebate` が `perform*Step` の実行結果を受け取ったとき, the Debate Pipeline shall 自分が dispatch した `stepKind` と実行結果に基づいて次ステップを決定し（turn の通常前進時のみ `decideNextStep` を呼ぶ）, 既存の enqueue 系ヘルパー（`enqueueStep`/`enqueueAfterTurn`/`enqueueChapterEnd`/`resumeFromFresh`）で投入する.
3. The Debate Pipeline shall not `step.ts` から `debate-orchestrator.ts` を import する（`decideNextStep`/enqueue 系/`loadStepContext` への step 層からの依存を持たない）.
4. Where `perform*Step` が実行オプションを必要とする場合, the Debate Pipeline shall `advanceDebate` が組み立てたオプションを引数として handler へ渡す（handler はオプション構築・`decideNextStep` を import しない）.
5. While 同一の永続データ・ペイロードが与えられたとき, the Debate Pipeline shall 分離の前後で enqueue されるタスク（stepKind・frontier・タスクキー）と Firestore 副作用を同一に保つ.

### Requirement 3: 論点状態の集約
**Objective:** 開発者として、論点（discussionPoint）の状態遷移と永続化が 1 モジュールに集約されていてほしい。そうすれば論点ドメインのロジックが handler に散らばらない。

#### Acceptance Criteria
1. The Debate Pipeline shall provide `discussion-points.ts` に, 論点状態の遷移関数（untouched 初期化・`introduced` 遷移・`addressed` 遷移）と永続化関数（`saveDiscussionPointStatuses`・`deleteDiscussionPointStatuses`）を集約する.
2. When `performOpenStep` が論点を初期化するとき, the Debate Pipeline shall `discussion-points.ts` の初期化関数を用いる（handler 内に untouched 初期化ロジックをインライン展開しない）.
3. When `performTurnStep` が再確認で論点を addressed に更新するとき, the Debate Pipeline shall `discussion-points.ts` の `addressed` 遷移関数を用いる.
4. The Debate Pipeline shall structure `discussion-points.ts` を 既存 `queued-intents.ts` と同じ「状態遷移＋永続化」モジュールパターンに揃える.
5. While 論点状態の遷移規則と永続化フィールド（`discussionPointStatuses`）が与えられたとき, the Debate Pipeline shall 集約前後で論点状態の挙動を同一に保つ.

### Requirement 4: ターン後処理の共通化
**Objective:** 開発者として、`executeTurn` の重複した後処理が 1 箇所にまとまっていてほしい。そうすれば片方だけ直す事故を防げる。

#### Acceptance Criteria
1. The Debate Pipeline shall extract `executeTurn` の freeze 分岐と通常分岐で重複する後処理（キュー消化→発言統計更新→信念変化永続化）を共通ヘルパーへ括り出す.
2. When freeze 分岐または通常分岐がコミットに成功したとき, the Debate Pipeline shall 同一の共通ヘルパーを呼び出す.
3. While 同一入力が与えられたとき, the Debate Pipeline shall 共通化前後で後処理の副作用（キュー消化・統計更新・信念変化）を同一に保つ.

### Requirement 5: 公開 API と振る舞いの不変性
**Objective:** 利用側コードの作者として、整理後も公開 API のシグネチャと観測可能な挙動が変わらないでほしい。そうすれば呼び出し側のロジックを書き換えずに済む。

#### Acceptance Criteria
1. The Debate Pipeline shall keep `advanceDebate` のシグネチャ（`(payload: TurnStepPayload) => Promise<boolean>`）と戻り値の意味を整理前後で同一に保つ.
2. The Debate Pipeline shall keep `decideNextStep` のシグネチャ・戻り値（`NextStep`）・判定規則（cap・早期終了・最終応答 +1）を整理前後で同一に保つ.
3. The Debate Pipeline shall keep `DEFAULT_OPTIONS` の値を整理前後で同一に保つ.
4. While 同一の永続データ・ペイロードが与えられたとき, the Debate Pipeline shall `advanceDebate` が整理前と同一の結果（生成・追記・enqueue・戻り値）を返す.
5. The Debate Pipeline shall preserve 各 step の冪等性・再入可能性・frontier 競合解決の挙動を整理前と同一に保つ.

### Requirement 6: import 経路の更新と一方向依存
**Objective:** 開発者として、移動したシンボルへの参照がすべて正しい経路を指し、ファイル間の依存が一方向であってほしい。そうすればビルドが壊れず構造が保たれる。

#### Acceptance Criteria
1. When `advanceDebate`・`decideNextStep` が `debate-orchestrator.ts` へ移動したとき, the Debate Pipeline shall 参照側（`api/debates.ts`・`debate-parity.test.ts`・`debate-step-idempotency.test.ts`・`decide-next-step.test.ts`）の import を `debate-orchestrator.ts` へ更新する.
2. When `ChapterEntry` が `debate.types.ts` へ移動したとき, the Debate Pipeline shall `debate-lifecycle.ts` ほか参照側の import を `debate.types.ts` へ更新する.
3. The Debate Pipeline shall update 分割された各ファイル間で相互に必要なシンボルの import を正しく解決する.
4. The Debate Pipeline shall not 再エクスポート（re-export）によって旧パスからの参照を温存する; 参照側を新パスへ直接書き換える.
5. The Debate Pipeline shall enforce 一方向の依存（`debate.types.ts` を最下層に、`debate-lifecycle.ts`・`discussion-points.ts` を中間、`debate-orchestrator.ts` → `step.ts` の順）を保ち, ファイル間に循環 import（型 import を含む）を発生させない.

### Requirement 7: 振る舞い等価性の検証
**Objective:** メンテナとして、リファクタリングが既存の振る舞いを壊していないことをテストで保証してほしい。そうすれば安心してマージできる。

#### Acceptance Criteria
1. The Debate Pipeline shall pass 既存テスト（`debate-parity.test.ts`・`debate-step-idempotency.test.ts`・`decide-next-step.test.ts`）を、アサーション・期待値を変更せずに通過する.
2. When 整理後に型チェック（`tsc`）を実行したとき, the Debate Pipeline shall 新たな型エラーを発生させない.
3. While テストの import パスのみが更新された状態であっても, the Debate Pipeline shall テストの検証ロジック（モック・アサーション・テストケース）を変更しない.

### Requirement 8: プロジェクト規約への準拠
**Objective:** チームとして、整理後のコードがプロジェクトのコード規約・構造ルールに沿っていてほしい。そうすれば一貫性が保たれる。

#### Acceptance Criteria
1. The Debate Pipeline shall name 新規ファイルを kebab-case（`debate-orchestrator.ts`・`discussion-points.ts`）で命名し、`functions/src/pipeline/debate/` 配下に置く.
2. The Debate Pipeline shall use アロー関数を標準とし、省略変数名を避ける既存スタイルを維持する.
3. The Debate Pipeline shall not 各 step の分岐を吸収する中央ディスパッチャや新たな抽象（next-step 記述子の共用体など）を導入する; `advanceDebate` の stepKind 別の次ステップ決定は既存の enqueue 系ヘルパーの呼び出しに留める.
4. Where テストファイルを置く必要が生じた場合, the Debate Pipeline shall ソースと同一ディレクトリに置かず `functions/src/tests/` 配下に配置する.
