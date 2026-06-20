# Implementation Plan

- [x] 1. Foundation: 型定義の更新
- [x] 1.1 (P) バックエンドの討論型から turnIndex 関連フィールドを除去する
  - `DebateTurn` から `turnIndex: number` フィールドを削除する
  - `QueuedIntent` の `triggerTurnIndex: number` を `triggerTurnId: string` に変更する
  - `DebateState` から `currentTurnIndex: number` と `lastFacilitatorTurnIndex: number` を削除する
  - 完了状態: 型変更により `functions` 全体で TypeScript コンパイルエラーが発生し、後続タスクで修正すべき箇所が明確になる
  - _Requirements: 1.1, 3.1, 4.1, 4.2_
  - _Boundary: debate.types.ts_

- [x] 1.2 (P) フロントエンドのセッション型から turnIndex 関連フィールドを除去する
  - `TurnDoc` から `turnIndex: number` を削除する
  - `PublishedTurn` から `turnIndex: number` を削除する
  - `ChapterDoc` から `startTurnIndex?: number` を削除する（session-document-restructure 以降のデッドコード）
  - 完了状態: `src` 全体で `TurnDoc.turnIndex` や `PublishedTurn.turnIndex` への参照がコンパイルエラーとして検出される
  - _Requirements: 5.1_
  - _Boundary: session.types.ts_

- [x] 2. Core: バックエンドパイプラインの更新
- [x] 2.1 (P) ターン書き込みと読み取りから turnIndex を除去する
  - `addTurn()` の `turnIndex` パラメータと Firestore 書き込みオブジェクトの `turnIndex` フィールドを削除する
  - `generateFacilitatorTurn()` と `generatePersonaTurn()` における `turnIndex = state.turns.length` の計算行を削除し、`addTurn()` 呼び出しと `state.turns.push()` から `turnIndex` を除去する
  - `generatePersonaTurn()` 内の `state.turns.find(t => t.turnIndex === queuedEntries[0].triggerTurnIndex)` を `state.turns.find(t => t.id === queuedEntries[0].triggerTurnId)` に変更する
  - `getDebateTurnsByTopicId()` のターンマッピングから `turnIndex: t.turnIndex` を除去し、末尾の `.sort((a, b) => a.turnIndex - b.turnIndex)` を削除する（chapters は chapterIndex 順でクエリ済み）
  - 完了状態: 新規書き込みされたターンドキュメントに `turnIndex` フィールドが含まれない
  - _Requirements: 1.2, 1.3, 1.4, 3.4_
  - _Boundary: turn.ts_
  - _Depends: 1.1_

- [x] 2.2 (P) Engagement History のキーを turnId に切り替える
  - `saveEngagements()` のパラメータ `turnIndex: number` を `turnId: string` に変更する
  - Firestore の書き込みキーを `[String(params.turnIndex)]` から `[params.turnId]` に、mergeFields を `history.${params.turnId}` に変更する
  - `evaluateEngagements()` の `saveEngagements` 呼び出しを `turnId: state.turns[state.turns.length - 1]?.id ?? ''` に変更する
  - 完了状態: `topics/{topicId}/engagements/{personaId}.history` のキーが nanoid 文字列形式で保存される
  - _Requirements: 2.1, 2.2, 2.4_
  - _Boundary: engagement.ts_
  - _Depends: 1.1_

- [x] 2.3 (P) QueuedIntent の triggerTurnId 参照と有効期限計算を更新する
  - `addQueuedIntents()` の `triggerTurnIndex: number` パラメータを `triggerTurnId: string` に変更する
  - Firestore 書き込みオブジェクト `{ triggerTurnIndex, intentSummary }` を `{ triggerTurnId, intentSummary }` に変更する
  - `expireQueuedIntents()` の有効期限判定を `state.turns.findIndex(t => t.id === item.triggerTurnId)` ベースに変更し、`-1`（未発見）の場合は期限切れとして扱う
  - 完了状態: 有効期限判定が triggerTurnId で正しく機能し、triggerTurnId 未発見の QueuedIntent が期限切れとして除去される
  - _Requirements: 3.2, 3.3, 3.5_
  - _Boundary: queued-intents.ts_
  - _Depends: 1.1_

- [x] 2.4 (P) DebateState の導出から連番依存変数を除去する
  - `getDebateState()` 冒頭の `turns.sort((a, b) => a.turnIndex - b.turnIndex)` を除去し、入力順をそのまま使用する
  - `currentTurnIndex` の計算行（`turns[turns.length-1].turnIndex + 1`）を削除する
  - `lastFacilitatorTurnIndex` のセット処理（`turns[i].turnIndex` 参照を含む）を削除する（デッドコード: 参照箇所なし）
  - QueuedIntent 有効期限フィルタを `currentTurnIndex - item.triggerTurnIndex <= INTENT_EXPIRY_TURNS` から `findIndex` ベース（task 2.3 の同一ロジック）に変更する
  - 完了状態: `getDebateState()` の戻り値に `currentTurnIndex`・`lastFacilitatorTurnIndex` フィールドが存在しない
  - _Requirements: 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - _Boundary: debate-state.ts_
  - _Depends: 1.1, 2.3_

- [x] 2.5 (P) debate-lifecycle.ts の engagement クリーンアップとターンマッピングを更新する
  - `restartChapter()` の `removedTurnIndexes` 変数を削除し、`history.${ti}` キー削除ループを `removedTurnIds`（既存の `Set<string>`）を使った `history.${id}` キー削除に変更する
  - `getChaptersByTopicId()` のターンマッピングから `turnIndex: t.turnIndex` を除去する
  - 完了状態: チャプターやり直し時に `history.${turnId}` キーが削除され、`turnIndex` キーへの参照が消える
  - _Requirements: 2.3_
  - _Boundary: debate-lifecycle.ts_
  - _Depends: 1.1_

- [x] 3. Core: 呼び出し元を新シグネチャに対応させる
- [x] 3.1 (P) intervention.ts の関数呼び出しを新シグネチャに対応させる
  - `persistInterventionTurn()` の `turnIndex = state.turns.length` 計算行を削除し、`addTurn()` 呼び出しと `state.turns.push()` から `turnIndex` を除去する
  - `tryIntervention()` の `addQueuedIntents()` 呼び出しの `triggerTurnIndex: Math.max(0, state.turns.length - 1)` を `triggerTurnId: state.turns[state.turns.length - 1]?.id ?? ''` に変更する
  - 完了状態: `intervention.ts` で TypeScript コンパイルエラーが発生しない
  - _Requirements: 1.3, 3.2_
  - _Boundary: intervention.ts_
  - _Depends: 2.1, 2.3_

- [x] 3.2 (P) debate-orchestrator.ts の addQueuedIntents 呼び出しを triggerTurnId に更新する
  - `executeTurn()` 内の `addQueuedIntents()` 呼び出しの `triggerTurnIndex: Math.max(0, state.turns.length - 1)` を `triggerTurnId: state.turns[state.turns.length - 1]?.id ?? ''` に変更する
  - 完了状態: `debate-orchestrator.ts` で TypeScript コンパイルエラーが発生しない
  - _Requirements: 3.2_
  - _Boundary: debate-orchestrator.ts_
  - _Depends: 2.3_

- [x] 4. Core: フロントエンドの更新
- [x] 4.1 (P) chapters ストアのターン結合ソートを除去する
  - `createChaptersStore` の `turns` getter から `.sort((a, b) => a.turnIndex - b.turnIndex)` を削除する
  - `chapters.flatMap((c) => c.turns)` でチャプター配列順・各チャプター内の配列順が保証される（orderBy chapterIndex + arrayUnion 順）
  - 完了状態: `turns` getter が `turnIndex` を参照せず、章順・配列順でターンを結合して返す
  - _Requirements: 5.2, 5.3, 5.4_
  - _Boundary: chapters.svelte.ts_
  - _Depends: 1.2_

- [x] 4.2 (P) 公開ページの PublishedTurn 構築から turnIndex を除去する
  - `routes/topics/[topicId]/+page.svelte` の `PublishedTurn` 構築処理から `turnIndex` フィールドの設定を削除する
  - 完了状態: `PublishedTurn` オブジェクトに `turnIndex` フィールドが含まれず、型エラーが発生しない
  - _Requirements: 5.1_
  - _Boundary: routes/topics/[topicId]/+page.svelte_
  - _Depends: 1.2_

- [x] 5. Validation: ビルド確認とテスト整合
- [x] 5.1 バックエンドのビルドを通し、TypeScript コンパイルエラーを完全解消する
  - `functions` で `npm run build` が警告・エラーなく通ることを確認する
  - `DebateTurn`・`QueuedIntent`・`DebateState` 型変更の波及箇所がすべて修正されていることを確認する
  - 完了状態: `functions` の TypeScript コンパイルが全エラーなしで完了する
  - _Requirements: 1.1, 1.4, 3.1, 4.1_
  - _Depends: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2_

- [x] 5.2 フロントエンドのビルドを通し、TypeScript コンパイルエラーを完全解消する
  - `src` で `tsc --noEmit` が警告・エラーなく通ることを確認する
  - `TurnDoc`・`PublishedTurn` 型変更の波及箇所（章ストア・公開ページ・管理画面）がすべて修正されていることを確認する
  - 完了状態: フロントエンドの TypeScript コンパイルが全エラーなしで完了する
  - _Requirements: 5.1_
  - _Depends: 4.1, 4.2_

- [x] 5.3 既存テストを新しい型と実装に合わせて修正する
  - `DebateTurn` や `QueuedIntent` を使ったテストデータから `turnIndex`・`triggerTurnIndex` フィールドを除去する
  - `addTurn()`・`saveEngagements()`・`addQueuedIntents()` を呼ぶテストのパラメータを新シグネチャに合わせる
  - `getDebateState()` の動作テストで `currentTurnIndex`・`lastFacilitatorTurnIndex` への参照を除去する
  - 完了状態: テストスイートが全件パスする
  - _Requirements: 1.1, 2.1, 3.1, 4.1_
  - _Depends: 5.1_
