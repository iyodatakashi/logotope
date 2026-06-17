# Implementation Plan

- [x] 1. `sessionId` を `topicId` に一本化する
  - `executeChapterTask` 冒頭の `const sessionId = topicId` 代入を削除する
  - `sessionId` と `topicId` を別引数として受け取っている関数（`runChapterLoop`・`generatePersonaTurn`・`generateUnansweredReply`・`finalizeDebate` など）のシグネチャから `sessionId` を除去し、`topicId` のみに統一する
  - Firestore ヘルパー（`addTurn`・`saveEngagements`・`setPendingIntents`・`loadPendingIntents`・`getDebateTurnsBySessionId`・`createPostDebateComment`・`completeDebateSession`）のパラメータ名を `sessionId` → `topicId` にリネームし、ヘルパー内部のパス生成も対応させる
  - `getDebateTurnsBySessionId` はより実態を表す名前（例: `getDebateTurnsByTopicId`）にリネームすることを検討する
  - TypeScript コンパイル（`tsc --noEmit`）でエラーが出ないことを確認して完了とする
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 2. 介入関数の共通化と chapterHistory 統合
- [x] 2.1 `persistInterventionTurn` ヘルパーを実装する
  - `tryStallIntervention` と `tryTopicDriftIntervention` の両方に共通するパターン（`saveFacilitatorTurn` の呼び出しと `SpeakerSelection | undefined` の返却）を1つのヘルパー関数としてまとめる
  - `targetPersonaId` が `undefined` であっても保存を行い（対象なし介入として正常動作）、`targetPersonaId` の有無に応じて `SpeakerSelection` または `undefined` を返す
  - ヘルパーをトップダウン原則に従い `tryTopicDriftIntervention` の直前に配置する
  - ヘルパー単独で呼び出して `saveFacilitatorTurn` の呼び出し有無と戻り値が期待どおりであることを確認して完了とする
  - _Requirements: 1.1, 1.2, 1.3_
  - _Boundary: persistInterventionTurn_

- [x] 2.2 介入関数を `chapterHistory` パラメータ化と `persistInterventionTurn` 使用に更新する
  - `tryStallIntervention` と `tryTopicDriftIntervention` のシグネチャに `chapterHistory: readonly DebateTurn[]` を追加し、内部で行っていた `state.history.filter(t => t.chapterId === chapter.id)` の計算を除去する
  - 両関数の末尾部分（`validPersonaId` 検証 + `saveFacilitatorTurn` + `SpeakerSelection` 返却）を `persistInterventionTurn` 呼び出しに置き換える（Drift は `targetId` が `undefined` の場合に呼び出し前に早期 return する）
  - `runChapterLoop` のループ先頭で `chapterHistory` を一元計算し、`tryStallIntervention` と `tryTopicDriftIntervention` の呼び出し時に渡す
  - TypeScript のエラーがなく、介入関数の重複コードが除去されていることを確認して完了とする
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_
  - _Depends: 2.1_
  - _Boundary: tryStallIntervention, tryTopicDriftIntervention, runChapterLoop_

- [x] 3. `runChapterLoop` の自己文書化
- [x] 3.1 クールダウン計算を名前付き関数に抽出し step 3 を置き換える
  - 「直近のファシリテーターターン以降のペルソナターン数」を計算するロジック（現 step 3）を `countPersonaTurnsSinceFacilitator(history)` として純粋関数に抽出する
  - ファシリテーターターンが存在しない場合は全履歴を対象にカウントする
  - `runChapterLoop` のステップ3部分をこの関数呼び出しに置き換え、番号コメント（`// 3.`）を削除する
  - 関数を `runChapterLoop` の直前（トップダウン原則に従い）に配置し、ループ内での動作が変わらないことを確認して完了とする
  - _Requirements: 4.1_
  - _Boundary: countPersonaTurnsSinceFacilitator, runChapterLoop_

- [x] 3.2 キューエンキューロジックを名前付き関数に抽出し step 6 を置き換える
  - 「高意欲かつ非選択ペルソナのインテントをキューに追加して Firestore に write-through する」ロジック（現 step 6）を `enqueueHighEngagementIntents(topicId, state, assessments, decision, triggerTurnIndex)` として抽出する
  - `runChapterLoop` のステップ6部分をこの関数呼び出しに置き換え、番号コメント（`// 6.`）を削除する
  - 関数を `runChapterLoop` の直前に配置し、キュー追加の挙動が変わらないことを確認して完了とする
  - _Requirements: 4.2_
  - _Depends: 3.1_
  - _Boundary: enqueueHighEngagementIntents, runChapterLoop_

- [x] 3.3 残存する番号付きコメントを整理する
  - `runChapterLoop` 内に残っている番号付きインラインコメント（`// 1.`〜`// 10.`）をすべて削除する
  - 削除後も読み手が処理の意図を理解できるよう、必要な箇所のみ番号なしの簡潔なコメントに置き換える
  - `runChapterLoop` を通読し、コメントなしで実行順序が自明に読めることを確認して完了とする
  - _Requirements: 4.3_
  - _Depends: 3.2_
  - _Boundary: runChapterLoop_

- [x] 4. テストと動作確認
- [x] 4.1 新規純粋関数のユニットテストを追加する
  - `countPersonaTurnsSinceFacilitator` に対して、ファシリテーターターンなし・末尾のみ・複数存在する各ケースをテストする
  - `persistInterventionTurn` に対して、`targetPersonaId` あり/なし それぞれで `saveFacilitatorTurn` 呼び出しと戻り値を検証する
  - 新規テストがすべてパスすることを確認して完了とする
  - _Requirements: 1.1, 4.1_

- [x] 4.2 既存テストのリグレッション確認
  - `pnpm test:unit`（または相当コマンド）を実行し `debate-orchestrator.test.ts` を含む既存テストが全件パスすることを確認する
  - TypeScript コンパイル（`tsc --noEmit`）でエラーがないことを最終確認する
  - すべてのテストが通ることを確認して完了とする
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_
  - _Depends: 4.1_
