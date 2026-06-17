# Implementation Plan

- [x] 1. `executeTurn` の介入パスを修正する

- [x] 1.1 介入検出後に高意欲メンバーを全員インテントキューに追加する
  - `evaluateEngagement` 実行後に介入が検出された場合、取得済みの `assessments` をそのまま使って `enqueueHighEngagementIntents` を呼び出す
  - ファシリテーターは発言者ではないため、除外する personaId には存在しないダミー ID（空文字等）を渡し、全高意欲メンバーがキュー対象となる
  - 通常ターン時と同じ「高意欲だが発言できなかった = キュー追加」ルールが介入時にも適用される
  - _Requirements: 1.1_

- [x] 1.2 介入検出時にファシリテーターターンを即時保存して早期リターンする
  - 介入検出後に `persistInterventionTurn` を呼び出してファシリテーターターンを `state.turns` に追加する
  - 指名がある場合は `state.targetPersona` に `{ personaId, targetedBy: 'facilitator' }` をセットする
  - `generatePersonaTurn` を呼ばずに `return true` で `executeTurn` を終了する
  - `state.pendingIntervention` への参照・セットをこの関数内から除去する
  - 介入後に `executeTurn` が `true` を返すことで、メインループが次のイテレーションへ正常に進む
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. `persistInterventionTurn` がファシリテーターターン保存後に `lastSpeakerId` をクリアする
  - ファシリテーターターンを `state.turns` に追加する既存処理の直後に `state.lastSpeakerId = undefined` を追加する
  - `state.pairConversationTurns = 0` の既存処理は変更しない
  - 変更後、次のイテレーションの `evaluateEngagement` が全メンバーを評価対象とする
  - _Requirements: 2.1, 2.2_

- [x] 3. メインループから `pendingIntervention` 遅延保存ブロックを除去する
  - `executeChapterTask` の while ループ冒頭にある `if (state.pendingIntervention)` ブロック全体を削除する
  - `executeTurn` の戻り値処理（`null` チェック、`activityLog.push`、`shouldEndChapterEarly`）はそのまま維持する
  - ループ除去後もターンキャップ（`chapterTurnCount() < cap`）と最大ターン（`state.turns.length < maxTurns`）の条件が正しく機能する
  - _Requirements: 1.1, 1.2_

- [x] 4. `DebateState` 型から `pendingIntervention` フィールドを削除する
  - `debate.types.ts` の `DebateState` 型定義から `pendingIntervention?: { ... }` フィールドを削除する
  - TypeScript のコンパイルが通ること（参照箇所がすべてタスク 1〜3 で除去済みであること）を確認する
  - `state-restore.ts` は `pendingIntervention` を復元対象に含めていないため変更不要

- [x] 5. 修正内容をテストする

- [x] 5.1 (P) `persistInterventionTurn` の `lastSpeakerId` クリアをテストする
  - `persistInterventionTurn` 呼び出し後に `state.lastSpeakerId` が `undefined` になること
  - `state.pairConversationTurns` が `0` になること（既存挙動の非退行確認）
  - _Requirements: 2.1_
  - _Boundary: persistInterventionTurn_

- [x] 5.2 (P) `executeTurn` の介入パスをテストする
  - 介入発火時に `enqueueHighEngagementIntents` が高意欲全メンバーを対象として呼び出されること
  - 介入発火時に `generatePersonaTurn` が呼ばれないこと
  - 介入発火時の戻り値が `true` であること
  - 指名ありの介入で `state.targetPersona` が指名メンバーの ID と `targetedBy: 'facilitator'` にセットされること
  - 介入なし時の既存フロー（メンバーターン生成）が変わらないこと（非退行確認）
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - _Boundary: executeTurn_

- [x] 5.3 介入後のターン順序と engagement 評価を統合テストする
  - 介入発火→次イテレーション実行の2ターン連続で、`state.turns` のターン順序がファシリテーター→メンバーになること
  - 介入後イテレーションの `evaluateEngagement` が `state.turns` にファシリテーターターンを含む状態で呼び出されること
  - `lastSpeakerId` が `undefined` の状態で全メンバーが評価対象となること
  - _Depends: 5.1, 5.2_
  - _Requirements: 3.1, 3.2, 3.3_
