# Implementation Plan

- [x] 1. runId の発行とタスク間引き継ぎ（実装済み）
- [x] 1.1 DebateState に runId フィールドを追加する
  - `DebateState` 型に `runId?: string` フィールドを追加する
  - ターン生成全体を通じて自分の世代 ID を参照できる状態になる
  - _Requirements: 2.3_

- [x] 1.2 討論の開始・再起動時に新しい runId を発行して返す
  - `activateDebate` が nanoid で runId を生成し Firestore の `topics/{topicId}.runId` に保存する
  - `restartChapter` も同様に新しい runId を発行する
  - 両関数の戻り値型を `Promise<string>`（runId）に変更する
  - `activateDebate` を呼ぶと Firestore に `runId` フィールドが書き込まれ、呼び出し元が runId 文字列を受け取れる
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 1.3 Cloud Tasks ペイロードに runId を含め次章タスクへ引き継ぐ
  - `enqueueChapterTask` のペイロードに runId を追加する
  - 次章タスクのエンキュー時にも同一の runId を引き継ぐ
  - チャプタータスクが自分の runId をペイロードから受け取れる状態になる
  - _Requirements: 2.1, 2.2_

- [x] 1.4 チャプタータスクが runId を受け取り DebateState に設定する
  - `executeChapterTask` の引数に `runId?: string` を追加する
  - 処理開始時に `state.runId = runId` を設定し、以降のターン生成で参照できる状態になる
  - _Requirements: 2.3_

- [x] 2. addTurn 内の世代ガード実装
- [x] 2.1 addTurn がターン書き込み前に世代照合を行う
  - `addTurn` のパラメータに `runId?: string` を追加する
  - `runId` が指定されている場合は Firestore の `topics/{topicId}.runId` を読み取って照合する
  - 照合失敗（ミスマッチ）時は Firestore へ書き込まず `null` を返す
  - スキップ条件（`params.runId` が未設定 / Firestore に `runId` フィールドが存在しない）の場合は照合なしで書き込みを実行する
  - Firestore 読み込みエラー時は保守的に `null` を返す（書き込みをブロック）
  - 戻り値型を `Promise<{ id: string } | null>` に変更する
  - 旧世代の呼び出しが `addTurn` を呼んだ際に `null` が返り Firestore に書き込まれない状態になる
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.3_

- [x] 3. 呼び出し元の null ハンドリング
- [x] 3.1 generatePersonaTurn のインラインチェックを削除し addTurn 経由に移行する
  - `generatePersonaTurn` 内の既存のインライン runId チェック（Firestore を直接読む箇所）を削除する
  - `addTurn` 呼び出しに `runId: state.runId` を追加する
  - `addTurn` が `null` を返した場合は `null` を返して後続処理を打ち切る
  - `executeTurn` が `null` を受けてチャプター処理が終了する（while ループが抜ける）状態になる
  - _Requirements: 3.1, 3.2, 4.1, 4.2_

- [x] 3.2 generateFacilitatorTurn が addTurn の null を伝播する
  - `generateFacilitatorTurn` 内の `addTurn` 呼び出しに `runId: state.runId` を追加する
  - `addTurn` が `null` を返した場合は `null` を返す（state.turns には追加しない）
  - 戻り値型を `Promise<{ content: string; targetPersonaId?: string } | null>` に変更する
  - 旧世代のファシリテーターターンが Firestore に書き込まれない状態になる
  - _Requirements: 3.1, 3.2, 4.1_

- [x] 3.3 (P) persistInterventionTurn が addTurn に runId を渡す
  - `persistInterventionTurn` 内の `addTurn` 呼び出しに `runId: state.runId` を追加する
  - `addTurn` が `null` を返した場合は `undefined` を返して介入処理を中止する（state.turns には追加しない）
  - 旧世代の介入ターンも Firestore に書き込まれない状態になる
  - _Requirements: 3.1, 3.2, 4.1_
  - _Boundary: intervention.ts_
  - _Depends: 2.1_

- [x] 4. テスト
- [x] 4.1 addTurn の世代照合ユニットテストを追加する
  - runId ミスマッチ時に `null` が返り Firestore 書き込みが呼ばれないことを検証する
  - `params.runId` 未設定・Firestore の `runId` 未設定の各スキップ条件で書き込みが実行されることを検証する
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4.2 競合状態シナリオのテストを追加する
  - runId ミスマッチ時に `generatePersonaTurn` が `null` を返すことを検証する
  - runId ミスマッチ時に `generateFacilitatorTurn` が `null` を返すことを検証する
  - `executeTurn` が `null` を受けてチャプター処理が終了することを検証する
  - _Requirements: 4.1, 4.2, 4.3_
