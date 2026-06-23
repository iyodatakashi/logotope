# Implementation Plan

> 挙動保存リファクタリング。各タスクはビルド green・既存テスト通過を保ったまま完了する。
> Foundation（1〜3）は `turn.ts`・`step.ts` を共有して順次実行。Core（4〜6）は別ファイルのため並行可能。

- [x] 1. 信念モジュール belief.ts を新設し信念ロジックを集約する
  - `getLatestBelief`（最新 version の belief 参照）を export 可能な形で belief.ts に置く
  - `applyBeliefChange`（信念変化の Firestore 永続化と引数 persona の in-memory 更新）を belief.ts に移す
  - turn.ts 内の `getLatestBelief` 利用箇所（クロージング・コメント生成）と step.ts の `applyBeliefChange` 利用を belief.ts からの import に切り替える
  - belief.ts は firestore・nanoid・types のみに依存し、討論ディレクトリ内の他ファイルを逆参照しない
  - 完了状態: belief.ts に信念の参照・永続化が集約され、`tsc` ビルドが通り `turn.test.ts` が変更なしで通過する
  - _Requirements: 1.4_

- [x] 2. 読み取り・状態導出を debate-state.ts に集約する
  - `isDebateActive`（討論稼働判定）・`getDebateTurnsByTopicId`（全ターン読み取り）を turn.ts から debate-state.ts へ移す
  - `getChaptersByTopicId`（章読み取り）を debate-lifecycle.ts から debate-state.ts へ移し、章とターンの読み取りを同居させる
  - `updateSpeakerStats`（DebateState の in-memory 更新）を turn.ts から debate-state.ts へ移す
  - 利用側（turn.ts の `isDebateActive`、debate-lifecycle.ts の `getChaptersByTopicId`、step.ts の `updateSpeakerStats`、debate-orchestrator.ts の各読み取り）の import 元を debate-state.ts に統一する
  - debate-state.ts は Firestore 書き込みを持たない（`updateSpeakerStats` は in-memory のみ）状態を保つ
  - 完了状態: 読み取り・状態導出が debate-state.ts に集約され、ビルドが通り `debate-state.test.ts` が変更なしで通過する
  - _Requirements: 1.2, 1.3, 2.1, 2.3, 2.4_
  - _Depends: 1_

- [x] 3. 終端処理モジュール post-debate-comments.ts を新設する
  - `persistPostDebateComments`（事後コメント生成・保存と phaseStatus の running→generated 遷移）を turn.ts から post-debate-comments.ts へ移す
  - belief.ts の `getLatestBelief` を import して最終信念を取得する
  - step.ts の `performCommentsStep` からの呼び出しを post-debate-comments.ts からの import に切り替える
  - phaseStatus の generated 遷移は終端フェーズの所有物として本モジュールに保持し、討論ループのライフサイクル遷移とは分離する
  - 完了状態: 終端コメント処理が独立モジュールに分離され、ビルドが通り既存テストが変更なしで通過する
  - _Requirements: 1.5_
  - _Depends: 1_

- [x] 4. (P) turn.ts をターン生成・追記の責務に限定する
  - 退避後の turn.ts に、追記・生成系（`addTurn`・`buildTurnRecord`・`generateFacilitatorTurn`・`generatePersonaTurn`・`generateChapterTransition`・`appendClosingTurn`）のみが残ることを確認する
  - `generatePersonaTurn` 内のキュー由来トリガ整形を内部ヘルパー `buildQueuedTrigger` として抽出し、契約・出力を不変に保つ
  - 完了状態: turn.ts が生成・追記の責務に限定され、`generatePersonaTurn`/`addTurn` のシグネチャ・副作用が不変で `turn.test.ts` が変更なしで通過する
  - _Requirements: 1.1_
  - _Boundary: turn.ts_
  - _Depends: 1, 2, 3_

- [x] 5. (P) debate-lifecycle.ts の restartChapter を意味単位に分割する
  - `restartChapter` を private ヘルパーへ分割する: 対象章のリセット、削除ターン由来 belief のバルク巻き戻し、engagement サブコレクション削除
  - belief のバルク巻き戻しは restart ライフサイクル固有の操作として debate-lifecycle.ts が所有する（belief.ts へは集約しない）
  - ライフサイクル変更（`activateDebate`・`markDebateStopped`・`updateChapterStatus`・`restartChapter`）が debate-lifecycle.ts に集約された状態を保つ
  - 分割後も処理順序・Firestore 書き込み・戻り値（新 runId）を現実装と同一に保つ
  - 完了状態: restartChapter が意味の伝わるヘルパーに分割され、`debate-lifecycle.test.ts` が変更なしで通過する
  - _Requirements: 2.2, 3.3, 3.4, 3.5_
  - _Boundary: debate-lifecycle.ts_
  - _Depends: 2_

- [x] 6. (P) step.ts の複数責務メソッドを分離する
  - `performTurnStep` から早期終了手前の論点カバレッジ再確認・補正（LLM 判定・addressed 更新・quietStreak リセット）を別関数へ抽出し、発火条件・閾値を不変に保つ
  - `executeTurn` から継続/盛り上がり（quietStreak）判定を純関数へ抽出し、算出式を不変に保つ
  - 抽出後も各メソッドの戻り値・Firestore 書き込み・呼び出し順序を現実装と同一に保ち、抽出関数に意味の伝わる名前を付ける
  - 完了状態: performTurnStep/executeTurn の責務が分離され、`debate-parity.test.ts`・`debate-step-idempotency.test.ts` が変更なしで通過する
  - _Requirements: 3.1, 3.2, 3.4, 3.5_
  - _Boundary: step.ts_
  - _Depends: 1, 2, 3_

- [x] 7. import 整合・依存方向・回帰の最終検証
  - debate-orchestrator.ts を含む全利用側の import 経路が新配置に揃い、`tsc` ビルドが成功することを確認する
  - 依存方向が一方向（orchestrator → step → turn/lifecycle → state/belief → types）に保たれ、循環 import が無いことを確認する（ステップ実行層・ターン層が orchestrator を import しない）
  - 公開 API（`advanceDebate`・`decideNextStep`・`DEFAULT_OPTIONS`）のシグネチャ・戻り値、enqueue されるタスク（stepKind・frontier・タスクキー）、Firestore 書き込みが分割前と同一であることをテストで確認する
  - 完了状態: 討論パイプライン全テスト（parity / idempotency / decide-next-step / turn / debate-state / debate-lifecycle 等）がアサーション変更なしで全通過する
  - _Requirements: 1.6, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3_
  - _Depends: 4, 5, 6_
