# Implementation Plan

- [x] 1. engagement.ts と queued-intents.ts をチャプタースコープに移行する
- [x] 1.1 (P) チャプター内ターンのみを評価入力として使い、保存先をチャプターサブコレクションに変更する
  - `evaluateEngagements` に `chapterId: string` と `chapterTurns: ReadonlyArray<DebateTurn>` を追加し、`state.turns` の代わりに `chapterTurns` を `evaluateEngagement`（persona-agent.ts）に渡す
  - `evaluateEngagementWithFallback` の `turns` パラメータを `chapterTurns` にリネームし、評価呼び出しに `chapterTurns` を使う
  - `saveEngagements`（内部関数）の書き込みパスを `topics/{topicId}/engagements/{personaId}` から `topics/{topicId}/chapters/{chapterId}/engagements/{personaId}` に変更する
  - `topics/{topicId}/engagements` への書き込みが発生しないこと
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 4.3_
  - _Boundary: engagement.ts_

- [x] 1.2 (P) queued-intents の保存先をチャプタースコープのエンゲージメントドキュメントに変更する
  - 全関数（`loadQueuedIntents`, `expireQueuedIntents`, `addQueuedIntents`, `consumeQueuedIntent`）に `chapterId: string` パラメータを追加する
  - `loadQueuedIntents` の読み取り先を `topics/{topicId}/chapters/{chapterId}/engagements` コレクションに変更し、各ドキュメントの `queuedIntents` フィールドを読む
  - `expireQueuedIntents`, `addQueuedIntents`, `consumeQueuedIntent` の書き込み先を `topics/${topicId}/chapters/${chapterId}/engagements/${personaId}` の `queuedIntents` フィールドに変更する（`mergeFields: ['queuedIntents']` で `history` フィールドを上書きしない）
  - 新チャプターで `loadQueuedIntents` を呼ぶと空の Map が返ること（チャプター未作成のため）
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.4_
  - _Boundary: queued-intents.ts_

- [x] 2. debate-orchestrator.ts の呼び出しをチャプター ID とチャプターターンを渡す形に更新する
  - `executeChapterTask` から `loadQueuedIntents(topicId, chapterDoc.id)` に `chapterId` を追加する
  - `executeTurn` のシグネチャに `chapterId: string` を追加し、`executeChapterTask` から `chapterDoc.id` を渡す
  - `evaluateEngagements` の呼び出しに `chapterId` と `chapterTurns: getChapterTurns()` を追加する
  - `evaluateEngagementWithFallback` の `turns: state.turns` を `chapterTurns: getChapterTurns()` に変更する
  - `expireQueuedIntents`, `addQueuedIntents`, `consumeQueuedIntent` の呼び出しに `chapterId` を追加する
  - パイプラインが1ターン処理を完了し、`chapters/{chapterId}/engagements/{personaId}` に書き込まれること
  - _Depends: 1.1, 1.2_
  - _Requirements: 1.1, 1.2, 3.2, 3.3, 4.2_

- [x] 3. (P) restartChapter のクリーンアップをチャプタースコープの削除に変更する
  - 廃棄対象チャプター（`discardChapters`）ごとに `topics/{topicId}/chapters/{chapterId}/engagements` サブコレクションの全ドキュメントを取得して削除する
  - 旧 `topics/{topicId}/engagements` コレクションへのアクセス処理（history フィールドの削除・queuedIntents の削除）を削除する
  - `restartChapter` 後に当該チャプターの `chapters/{chapterId}/engagements` サブコレクションが空になること
  - _Depends: 1.1, 1.2_
  - _Requirements: 5.1, 5.2_
  - _Boundary: debate-lifecycle.ts_

- [x] 4. フロントエンドのエンゲージメントストアをチャプタースコープに対応させる
- [x] 4.1 engagements.svelte.ts の購読先と Map キーをチャプタースコープに変更する
  - `createEngagementsStore` に `setChapterId(chapterId: string | null)` メソッドを追加し、呼び出し時に旧購読を解除して `topics/{topicId}/chapters/{chapterId}/engagements` への `onSnapshot` を張り直す
  - `buildEngagementsMap` のキー変換を `parseInt(key, 10)` から文字列のまま（turnId）に変更し、戻り値を `Map<string, EngagementHistoryEntryWithPersona[]>` にする
  - `EngagementHistoryEntryWithPersona` の `turnIndex: number` フィールドを `turnId: string` に変更する
  - `chapterId` が `null` のとき購読せず空 Map を返すこと
  - Firestore セキュリティルールが `topics/{topicId}/chapters/{chapterId}/engagements` サブコレクションへの admin 読み取りを許可していることを確認する
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: engagements.svelte.ts_

- [x] 4.2 currentTopic.svelte.ts と Phase5Debate.svelte を新ストア API に対応させる
  - `currentTopic.svelte.ts` に `chaptersStore.runningChapter?.id` の変化を監視するリアクティブ処理を追加し、変化時に `engagementsStore.setChapterId(id ?? null)` を呼ぶ
  - `Phase5Debate.svelte` の `engagementsMap.get(t.turnIndex)` を `engagementsMap.get(t.id)` に変更する
  - 第1章実行開始時に engagementsStore が第1章の `engagements` サブコレクションを購読し、エンゲージメントが表示されること
  - _Depends: 4.1_
  - _Requirements: 6.1, 6.2_

- [x] 4.3 (P) topics.svelte.ts の deleteTopic をチャプター engagements サブコレクション削除に対応させる
  - `topics/{topicId}/engagements` の `getDocs` 取得と削除対象への追加を削除する
  - `chaptersSnap.docs` の各チャプター ID に対して `topics/{topicId}/chapters/{chapterId}/engagements` の全ドキュメントを取得してバッチ削除対象に追加する
  - トピック削除後に Firestore の `chapters/{chapterId}/engagements` サブコレクションのドキュメントが残留しないこと
  - _Requirements: 5.1_
  - _Boundary: topics.svelte.ts_

- [x] 5. テストを新しいシグネチャとチャプタースコープの動作に合わせて更新する
- [x] 5.1 (P) バックエンドのテストを新シグネチャに対応させ、チャプタースコープの動作を検証する
  - `engagement.test.ts`（または関連テスト）を更新し、`chapterId` / `chapterTurns` が正しく渡されること・`state.turns` が `evaluateEngagement` に渡されないことを確認するアサーションを追加する
  - `queued-intents.test.ts` を更新し、`loadQueuedIntents` がチャプタースコープのコレクションを参照すること・新チャプターで空 Map が返ることを確認する
  - `debate-orchestrator.test.ts` のモックを `chapterId` / `chapterTurns` 受け渡しに対応させる
  - バックエンドの全ユニットテストが PASS すること
  - _Requirements: 1.1, 1.2, 1.3, 3.2, 3.3_
  - _Boundary: engagement.ts, queued-intents.ts, debate-orchestrator.ts_

- [x] 5.2 (P) フロントエンドのテストを新ストア API に対応させる
  - `engagements.svelte.ts` のテストを更新し、`buildEngagementsMap` が文字列キー（turnId）で正しく Map を構築することを確認する
  - `setChapterId` 呼び出し時に購読先が切り替わること・`null` のとき空 Map になることをテストする
  - フロントエンドの全ユニットテストが PASS すること
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: engagements.svelte.ts_
