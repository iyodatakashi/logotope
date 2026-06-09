# Implementation Plan

- [x] 1. Firestoreドキュメント型定義の追加
- [x] 1.1 Firestore固有のドキュメント型をフロントエンド型定義ファイルに追加する
  - StakeholderDoc, InterviewDoc, BeliefDoc, TurnDoc, PostDebateCommentDoc のインターフェースを定義する
  - TopicDoc, PersonaDoc, SessionDoc を定義し、埋め込みサブ型を参照させる
  - Timestamp は `firebase/firestore` から import する（既存の PublishedDebateDetail 等の型は変更しない）
  - pnpm build でフロントエンドが型エラーなくコンパイルできることを確認する
  - _Requirements: 1.1, 1.4, 2.10_

- [x] 2. repository.ts のFirestore Admin SDK 再実装
- [x] 2.1 AIパイプライン用の書き込み関数11本をFirestore Admin SDKで実装する
  - DataConnect の全インポートと既存関数をクリアし、`firebase-admin/firestore` のみを使う構成に切り替える
  - updateTopicStatus / createStakeholderMap / createPersonaProfile / approvePersonaProfiles を実装する
  - createCompletedPersonaInterview / createErrorPersonaInterview / createPersonaBelief を実装する
  - createDebateSession は sessions/0 が存在する場合スキップする冪等実装にする
  - completeDebateSession / createDebateTurn / createPostDebateComment を実装する
  - ターン・信念・コメントの配列追記は FieldValue.arrayUnion() で原子的に行う
  - 全タイムスタンプは Timestamp.now()（firebase-admin/firestore）を使う
  - 新規ドキュメントIDは nanoid() で生成する
  - _Requirements: 1.3, 1.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11_
  - _Boundary: Repository_

- [x] 2.2 AIパイプライン用の読み込み関数2本を実装し、不要な関数をすべて削除する
  - getTopicById(id): topics/{id} を読み、存在しない場合 null を返す実装にする
  - getApprovedPersonasByTopicId(topicId): approved === true のペルソナを sortOrder 昇順で返す実装にする（interview・beliefs は persona ドキュメントに埋め込み済みのため個別取得関数は不要）
  - ストアが代替する読み込み関数（listTopics, getPersonasByTopicId, getDebateSessionByTopicId 等）を削除する
  - 死活コード（createPersonaInterview, completePersonaInterview, updatePersonaInterviewStatus）を削除する
  - npm --prefix functions run build でコンパイルエラーがないことを確認する
  - _Requirements: 5.12, 5.13, 5.16, 5.19, 5.20_
  - _Boundary: Repository_

- [x] 3. Firestoreリアルタイム同期ストアの作成
- [x] 3.1 (P) topicsコレクション全件を購読し、トピックの作成・削除ができるストアを作成する
  - $state + onSnapshot + start/stop パターンで topics コレクションをリアルタイム購読する（createdAt 降順）
  - 初回snapshot受信時に isLoaded を true にする（ドキュメントの存在有無にかかわらず）
  - createTopic(title): nanoid() でIDを生成し Firestore に setDoc する
  - deleteTopic(topicId): topics/{topicId} とそのサブコレクション（personas/*, sessions/0）を batch delete する（batch 500件制限を考慮して分割する）
  - 全関数はアロー関数で記述する
  - ストアを start() した後に topics リストが自動更新されることを確認する
  - _Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.6, 2.8, 2.9, 3.1, 3.3, 3.4_
  - _Boundary: TopicsStore_

- [x] 3.2 (P) 単一topicドキュメントを購読し、ステークホルダー承認・討論公開・リセットができるストアを作成する
  - $state + onSnapshot + start/stop パターンで topics/{topicId} をリアルタイム購読する
  - ドキュメントが存在しない場合 topic は null、isLoaded は true にする
  - approveStakeholders(): stakeholders.approved を true に更新する
  - publishDebate(): status を 'published' に、sessions/0.publishedAt を Timestamp.now() に batch write で更新する
  - resetDebate(): sessions/0 を削除し status を 'interviewing' に戻す
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8, 2.9, 3.1, 3.4_
  - _Boundary: TopicStore_

- [x] 3.3 (P) personasサブコレクションを購読し、ペルソナの承認・リセットができるストアを作成する
  - $state + onSnapshot + start/stop パターンで topics/{topicId}/personas を sortOrder 昇順で購読する
  - approvePersonas(): 現在の personas リストを使い batch updateDoc で全件 approved: true にする
  - resetPersonas(): 全 persona を batch delete し topics/{topicId}.status を 'surveying' に更新する
  - start() 後に personas リストが自動更新されることを確認する
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 2.8, 2.9, 3.1, 3.4_
  - _Boundary: PersonasStore_

- [x] 3.4 (P) sessions/0ドキュメントを購読する読み取り専用ストアを作成する
  - $state + onSnapshot + start/stop パターンで topics/{topicId}/sessions/0 を購読する（書き込み関数なし）
  - ドキュメントが存在しない場合（セッション未作成）session は null、isLoaded は true にする
  - セッションが AI パイプラインから更新されると自動的に session state が更新されることを確認する
  - _Requirements: 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.8, 2.9_
  - _Boundary: SessionStore_

- [x] 4. Firestoreセキュリティルールの定義
- [x] 4.1 topics / personas / sessions コレクションの読み書きルールを firestore.rules に追加する
  - 認証済みユーザー: topics/** の読み書きをすべて許可する
  - 未認証ユーザー: status == 'published' の topics ドキュメントを読める
  - 未認証ユーザー: 親 topic の status を get() で確認し published であれば personas を読める
  - 未認証ユーザー: publishedAt != null の sessions ドキュメントを読める
  - debate_progress/{topicId}: 未認証でも read 可能、write は引き続き禁止（if false）を維持する
  - Firestore エミュレーターで認証済み/未認証それぞれの読み書きアクセスが想定通りになることを確認する
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 5. DataConnectの完全撤廃とビルド確認
- [x] 5.1 DataConnect関連ファイルと中継APIルートをすべて削除する
  - src/lib/server/dataconnect.ts を削除する
  - src/routes/api/debates/+server.ts と src/routes/api/debates/[id]/+server.ts を削除する
  - src/routes/+page.server.ts と src/routes/debate/[id]/+page.server.ts を削除する
  - src/dataconnect-generated/ ディレクトリを削除する
  - dataconnect/ ディレクトリ（スキーマ・コネクター設定）を削除する
  - firebase.json から dataconnect エミュレーター設定を削除する
  - _Depends: 2.2, 3.1_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 5.2 DataConnect パッケージ依存を除去してビルドが成功することを確認する
  - ルート package.json から @dataconnect/generated を削除する
  - npm --prefix functions run build がエラーなく完了することを確認する
  - pnpm build がエラーなく完了することを確認する
  - _Depends: 5.1_
  - _Requirements: 6.8, 6.9, 6.10_
