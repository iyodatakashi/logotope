# Requirements Document

## Project Description (Input)
debate-orchestrator.ts, step.ts, turn.ts debate-lifecycle.ts, debate-state.ts 周辺のコードを整理する。責任範囲が複数に跨っているメソッドの分離、コードを置くファイルの整理など。

## Introduction

本仕様は、討論パイプラインのオーケストレーション層 5 ファイル（`debate-orchestrator.ts`・`step.ts`・`turn.ts`・`debate-lifecycle.ts`・`debate-state.ts`）周辺の**挙動保存リファクタリング**を定義する。

直近の `debate-orchestrator-step-split` で「チェーン駆動（orchestrator）／ステップ実行（step）／論点状態（discussion-points）」の層分割は完了した。一方で残る課題として、(1) `turn.ts` に「ターン生成・追記」以外の責務（討論稼働判定・全ターン読み取り・信念永続化・事後コメント・話者統計更新）が同居している、(2) 永続データの「読み取り（query/load）」と「変更（mutation）」が `debate-lifecycle.ts` / `debate-state.ts` / `turn.ts` に分散している、(3) 単一メソッドが複数責務を抱えている（`performTurnStep` のカバレッジ補正、`executeTurn` の継続/盛り上がり判定、`restartChapter` の多段永続化）、という構造的混在がある。

本リファクタリングは、これらを責務に基づいて再配置・分離するが、**外部から観測可能な振る舞い（生成・追記・enqueue されるタスク・Firestore への書き込み・公開 API のシグネチャと戻り値）は一切変えない**。既存テストはアサーションを変えず、import パス更新のみで通過させる。

## Boundary Context

- **In scope**:
  - `turn.ts` を「ターンの生成・冪等追記」の責務に絞り、それ以外の責務（討論稼働判定・全ターン読み取り・ペルソナ信念永続化・事後コメント生成・話者統計の in-memory 更新）を責務の合うファイルへ再配置する
  - 永続データの「読み取り（query/load）」と「変更（mutation）」を、`debate-state.ts`（読み取り・状態導出）と `debate-lifecycle.ts`（ライフサイクル変更）の境界に沿って整理する
  - 複数責務を抱えるメソッドを分離する: `performTurnStep` の early-end 論点カバレッジ再確認・補正、`executeTurn` の継続/盛り上がり（quietStreak）判定、`restartChapter` の独立した複数永続化操作、`generatePersonaTurn` の縦長な前処理
  - 移動・分離に伴う各ファイル間および利用側（`debate-orchestrator.ts`・`step.ts`・`api/debates.ts`・該当テスト）の import 経路の更新
  - 一方向の依存（orchestrator → step → turn/state/lifecycle）と循環 import 回避の維持
- **Out of scope**:
  - アルゴリズム・判定規則・パフォーマンスの変更（`decideNextStep` の規則、frontier 競合解決、冪等追記ロジック、カバレッジ再確認の発火条件・閾値、quietStreak の算出式は不変）
  - 公開 API（`advanceDebate` / `decideNextStep` / `DEFAULT_OPTIONS`）および外部から呼ばれる関数のシグネチャ・引数・戻り値の変更
  - 既存テストのアサーション・期待値・モックの変更（import パスのみ更新可）
  - Firestore のドキュメント構造・フィールド・書き込みタイミングの変更
  - 型のスキーマ変更（命名統一は別 spec `chapter-type-unification` の領域）
  - 機能追加・バグ修正（既存の挙動は不具合を含めてそのまま保存する）
- **Adjacent expectations**:
  - `api/debates.ts` の `onTaskDispatched` / `onCall` ハンドラは引き続き同一シグネチャで対象関数を呼び出せる
  - `turn-step-task.ts`（`enqueueTurnStep` / `taskKey`）との連携インターフェースは不変
  - 先行 spec `debate-orchestrator-step-split`・`debate-orchestrator-cleanup`・`chapter-turn-task-decomposition` で確立した層構成・per-turn ステップチェーン設計を踏襲する
  - 新規に集約モジュールを設ける場合は、既存 `queued-intents.ts` / `discussion-points.ts`（状態遷移＋永続化を 1 モジュールに集約）の構成パターンに揃える

## Requirements

### Requirement 1: turn.ts をターン生成・追記の責務に限定する
**Objective:** 開発者として、`turn.ts` には「ターンの生成・冪等追記」に直接関わる関数だけが置かれていてほしい。そうすれば、ターン生成の挙動を読むときに無関係な討論ライフサイクル・信念・コメントのコードを読み飛ばさずに済む。

#### Acceptance Criteria
1. When `turn.ts` の整理が完了したとき, the Debate Pipeline shall ターンの生成・冪等追記・ターンレコード構築（`addTurn`・`buildTurnRecord`・`generateFacilitatorTurn`・`generatePersonaTurn`・`generateChapterTransition`・`appendClosingTurn`）を `turn.ts` に残す.
2. When 討論稼働状態の判定（`isDebateActive`）が再配置されたとき, the Debate Pipeline shall それを討論の稼働状態（phase / phaseStatus）を扱う責務のファイルへ移し、`turn.ts` から当該定義を除去する.
3. When 全章のターン読み取り（`getDebateTurnsByTopicId`）が再配置されたとき, the Debate Pipeline shall それを永続データの読み取り・状態導出を担う責務のファイルへ移す.
4. When ペルソナ信念の永続化（`applyBeliefChange`）が再配置されたとき, the Debate Pipeline shall それをペルソナ・信念ドメインを扱う責務のファイルへ移す.
5. When 事後コメント生成と phaseStatus 遷移（`persistPostDebateComments`）が再配置されたとき, the Debate Pipeline shall それを討論終端処理を扱う責務のファイルへ移す.
6. The Debate Pipeline shall 上記の移動後も、各関数の呼び出し側（`step.ts`・`debate-orchestrator.ts`・その他利用側）の import 経路を新しい配置に合わせて更新し、ビルドが成功する状態を保つ.

### Requirement 2: 永続データの読み取りと変更を責務境界に沿って整理する
**Objective:** 開発者として、永続データの「読み取り（query/load）」と「変更（mutation）」がファイル境界で見分けられる状態であってほしい。そうすれば、状態を読むコードと状態を書き換えるコードを別々に追える。

#### Acceptance Criteria
1. The Debate Pipeline shall 永続データから in-memory 状態を導出・読み取る責務（`getDebateState`・`loadChapterProgress`・章/ターンの読み取り）を、状態導出を担うファイルに集約する.
2. The Debate Pipeline shall 討論・章のライフサイクルを変更する責務（`activateDebate`・`markDebateStopped`・`updateChapterStatus`・`restartChapter`）を、ライフサイクル変更を担うファイルに集約する.
3. While 読み取りと変更を別ファイルに分けるとき, the Debate Pipeline shall 章の読み取り（`getChaptersByTopicId`）と全ターンの読み取り（`getDebateTurnsByTopicId`）が同一の読み取り責務のファイルに同居する状態にする.
4. When 話者統計の in-memory 更新（`updateSpeakerStats`）の配置を見直すとき, the Debate Pipeline shall それを in-memory 状態（`DebateState`）を扱う責務のファイルに置く.

### Requirement 3: 複数責務を抱えるメソッドを分離する
**Objective:** 開発者として、1 つのメソッドが「主たる処理」と「付随する別責務の処理」を兼ねていない状態にしたい。そうすれば、各責務を独立して読み・テストできる。

#### Acceptance Criteria
1. When `performTurnStep` を整理するとき, the Debate Pipeline shall 「ターン実行と実行結果の算出」と「early-end 手前の論点カバレッジ再確認・補正（LLM 判定・`addressed` 更新・quietStreak リセット）」を別の関数に分離する.
2. When `executeTurn` を整理するとき, the Debate Pipeline shall 「話者選択・介入・発言生成・永続化」と「継続/盛り上がり（quietStreak）の判定」を別の関数に分離する.
3. When `restartChapter` を整理するとき, the Debate Pipeline shall 章リセット・事後コメント初期化・信念巻き戻し・engagement 削除という独立した永続化操作を、それぞれ意味の伝わる単位の関数に分離する.
4. While 各メソッドを分離するとき, the Debate Pipeline shall 分離前後で同一の Firestore 書き込み・同一の戻り値・同一の呼び出し順序を保つ.
5. The Debate Pipeline shall 分離で新設する関数に、省略しない意味の伝わる名前を付ける.

### Requirement 4: 観測可能な挙動と公開契約を保存する
**Objective:** 開発者として、この整理が純粋な構造変更であり、討論の生成結果やタスク投入が変わらないことを保証したい。そうすれば、安心してリファクタリングを取り込める。

#### Acceptance Criteria
1. The Debate Pipeline shall 公開 API（`advanceDebate` / `decideNextStep` / `DEFAULT_OPTIONS`）のシグネチャ・引数・戻り値を不変に保つ.
2. While 1 ステップを処理するとき, the Debate Pipeline shall 整理前と同一の stepKind・frontier・タスクキーで次ステップタスクを enqueue する.
3. While ターン・まとめ・クロージング・コメントを生成するとき, the Debate Pipeline shall 整理前と同一の Firestore 書き込み（フィールド・条件・冪等性）を行う.
4. If 既存テスト（debate-parity / debate-step-idempotency / decide-next-step 等）を実行したとき, then the Debate Pipeline shall アサーションを変更せず、import パスの更新のみでそれらを通過させる.

### Requirement 5: 依存方向の一方向性と循環 import 回避を維持する
**Objective:** 開発者として、再配置後もレイヤ間の依存が一方向であってほしい。そうすれば、層をまたぐ循環 import や暗黙の結合が生まれない。

#### Acceptance Criteria
1. The Debate Pipeline shall チェーン駆動層（orchestrator）からステップ実行層（step）・ターン層（turn）・状態層（state）・ライフサイクル層（lifecycle）への一方向の依存を維持する.
2. If 関数の再配置によって循環 import が生じうるとき, then the Debate Pipeline shall 配置先を見直して循環を生じさせない.
3. The Debate Pipeline shall ステップ実行層・ターン層が orchestrator（`debate-orchestrator.ts`）に依存しない状態を保つ.
