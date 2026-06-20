# Implementation Plan

## 1. 型定義の更新（Foundation）

- [x] 1.1 フロントエンドの型定義から `topic.stakeholders` フィールドを除去する
  - `TopicDoc` から `stakeholders?: StakeholderDoc[]` フィールドを除去する
  - `StakeholderDoc` 型自体は `topic.types.ts` に残す（型の移動は別スコープ）
  - 完了状態: `TopicDoc` に `stakeholders` フィールドが存在しない
  - _Requirements: 1.1, 1.5_

## 2. バックエンド CF の書き込み先変更

- [x] 2.1 (P) `generateStakeholders` CF を `stakeholders/0` に直接書き込む構造に変更する
  - リクエストに `topicId` を追加する（現状は `title` のみ）
  - `stakeholder-agent.ts` の実行結果を Admin SDK で `topics/{topicId}/stakeholders/0` に `setDoc` する
  - CF のレスポンスから `stakeholders` フィールドを除去する（void 相当に変更）
  - 完了状態: CF 呼び出し後、`stakeholders/0` にステークホルダーデータが保存されレスポンスは空
  - _Requirements: 1.2, 1.3, 1.4_
  - _Boundary: functions/src/api/stakeholders.ts_

- [x] 2.2 (P) `generatePersonas` CF の `stakeholders` 引数を除去して `stakeholders/0` から直接読む構造に変更する
  - `request.data` から `stakeholders` フィールドを除去する
  - Admin SDK で `topics/{topicId}/stakeholders/0` を `getDoc` してステークホルダーデータを取得する
  - `stakeholders/0` が存在しない場合は `invalid-argument` エラーを返す
  - 完了状態: `generatePersonas` CF が `stakeholders` 引数なしで動作し、`stakeholders/0` からデータを読み込む
  - _Requirements: 2.1, 2.2, 2.3_
  - _Boundary: functions/src/api/personas.ts_

## 3. フロントエンドストアの新設と統合

- [x] 3.1 `createStakeholdersStore` を新設する
  - `createChapterAnalysisStore` と同じパターンで `topics/{topicId}/stakeholders/0` を `onSnapshot` 購読するストアを実装する
  - `stakeholders: StakeholderDoc[]`（ドキュメント未存在時は空配列）と `isLoaded: boolean` を公開する
  - `start()` と `stop()` でサブスクリプションのライフサイクルを管理する
  - 完了状態: ストアが `stakeholders/0` の変更をリアルタイムで反映し、`isLoaded` が初回スナップショット受信後に `true` になる
  - _Requirements: 3.1, 3.2_
  - _Boundary: src/lib/stores/stakeholders.svelte.ts_

- [x] 3.2 `currentTopicStore` に `stakeholdersStore` を統合する
  - `currentTopicStore` の `create()` 内に `stakeholdersStore` を追加する（他のストアと同じ初期化パターン）
  - `start()` で `stakeholdersStore.start()` を呼び、返却するクリーンアップ関数で `stop()` を呼ぶ
  - `get stakeholdersStore()` を外部公開する
  - 完了状態: トピック画面に入ると `stakeholdersStore` が起動し、離脱時に停止する
  - _Requirements: 3.3, 3.5_
  - _Depends: 3.1_
  - _Boundary: src/lib/stores/currentTopic.svelte.ts_

## 4. フロントエンドモデル・UI の更新

- [x] 4.1 `createTopic.svelte.ts` の stakeholders 関連コードを新構造に更新する
  - `let stakeholders = $state(...)` と `get stakeholders()` を除去する
  - `generateStakeholders` の呼び出しに `topicId` を追加し、レスポンスから `stakeholders` を受け取る処理を削除する
  - `generatePersonas` の呼び出しから `stakeholders: stakeholderItems` を除去する
  - `resetStakeholders` を `updateDoc({ stakeholders: [] })` から `deleteDoc(stakeholders/0)` に変更する
  - 完了状態: `createTopic.svelte.ts` 内に `topic.stakeholders` への読み書き参照が残らない
  - _Requirements: 2.4, 4.1, 4.2, 4.3_
  - _Depends: 3.1_

- [x] 4.2 `Phase1Stakeholders.svelte` のデータ参照元を新ストアに変更する
  - `currentTopicStore.topic?.stakeholders` の参照を `currentTopicStore.stakeholdersStore.stakeholders` に変更する
  - 完了状態: Phase1 画面がステークホルダーをリアルタイムで表示し、生成・リセット・承認が正常動作する
  - _Requirements: 3.4_
  - _Depends: 3.2_

## 5. Firestore セキュリティルールの更新

- [x] 5.1 `stakeholders/{docId}` のセキュリティルールを追加する
  - `topics/{topicId}` ブロック内に `match /stakeholders/{docId}` を追加する
  - 認証済みユーザーのみ読み書き可能とする（未認証読み取りは許可しない）
  - 完了状態: `stakeholders/0` への未認証アクセスが拒否され、認証済みユーザーは読み書きできる
  - _Requirements: 5.1, 5.2_
  - _Boundary: firestore.rules_
