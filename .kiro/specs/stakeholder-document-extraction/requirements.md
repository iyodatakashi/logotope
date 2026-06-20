# Requirements Document

## Project Description (Input)
Phase1のステークホルダーをtopic.stakeholders[]の埋め込み配列から、topics/{topicId}/stakeholders/0 固定IDドキュメントのstakeholders[]フィールドへ移動する。chapterAnalysis/0・postDebateComments/0と同様のパターン。あわせてgeneratePersonas CFのstakeholders引数をなくし、CF側がFirestoreから直接読む構造にする。

## Introduction

`topics/{topicId}` ドキュメントは現在 `stakeholders` フィールドを埋め込み配列として保持しているが、これは Phase1 の生成成果物であり `chapterAnalysis/0`・`postDebateComments/0` と性質が同じである。また `generatePersonas` Cloud Function がフロントエンド経由でステークホルダーデータを受け取る構造は、不要なデータ転送を生んでいる。

このフィーチャーでは `topic.stakeholders[]` を廃止し、固定 ID サブドキュメント `topics/{topicId}/stakeholders/0` に移動する。`generateStakeholders` CF は生成結果を直接 Firestore に書き込み、`generatePersonas` CF はフロントエンドから引数を受け取らずに Firestore から直接読み込む。

## Boundary Context

- **In scope**: `topic.stakeholders[]` の廃止と `stakeholders/0` ドキュメントへの移行、`generateStakeholders` CF の書き込み先変更、`generatePersonas` CF の引数除去、フロントエンドストア新設、リセット処理の更新、Firestore セキュリティルール更新
- **Out of scope**: ステークホルダー生成ロジック・プロンプトの変更、ペルソナ生成アルゴリズムの変更、`Stakeholder` 型のフィールド変更
- **Adjacent expectations**: `firebase.md` の「1:1 関係は固定 ID で表現する」「埋め込み vs サブコレクション」原則を遵守する。`chapterAnalysis/0`・`postDebateComments/0` と同じ固定 ID パターンを適用する

---

## Requirements

### Requirement 1: stakeholders/0 固定 ID ドキュメントへの移行

**Objective:** As a 開発者, I want `topics/{topicId}/stakeholders/0` にステークホルダーデータを保持する, so that Phase1 生成成果物が他のフェーズ成果物（`chapterAnalysis/0`・`postDebateComments/0`）と一貫したパターンで管理できる。

#### Acceptance Criteria

1. The System shall `topics/{topicId}` ドキュメントから `stakeholders` フィールドを除去する
2. The System shall ステークホルダーデータを `topics/{topicId}/stakeholders/0` ドキュメントの `stakeholders` フィールドに保存する
3. When `generateStakeholders` が実行される, the Stakeholder Pipeline shall 生成結果をフロントエンドへ返さず、`stakeholders/0` ドキュメントに直接書き込む
4. The `stakeholders/0` document shall `stakeholders: StakeholderDoc[]` フィールドのみを保持する（メタデータフィールドは追加しない）
5. The TypeScript 型定義 shall `TopicDoc.stakeholders` フィールドを除去し、`StakeholderDoc` 型を `stakeholder.types.ts` または専用ファイルで管理する

---

### Requirement 2: generatePersonas CF のステークホルダー引数除去

**Objective:** As a 開発者, I want `generatePersonas` CF がステークホルダーを Firestore から直接読む, so that フロントエンドがサーバー処理用のデータをリクエストに含める必要がなくなる。

#### Acceptance Criteria

1. The `generatePersonas` CF shall `stakeholders` パラメータをリクエストから受け取らない
2. When `generatePersonas` が実行される, the Persona Pipeline shall `stakeholders/0` ドキュメントを Firestore から読み込んでステークホルダーデータを取得する
3. If `stakeholders/0` ドキュメントが存在しない, the `generatePersonas` CF shall エラーを返す
4. The Frontend shall `generatePersonas` の呼び出し時に `stakeholders` フィールドをリクエストに含めない

---

### Requirement 3: フロントエンドストアの新設

**Objective:** As a 開発者, I want `stakeholders/0` を購読する専用ストアを持つ, so that Phase1 画面がリアルタイムにステークホルダーデータを参照できる。

#### Acceptance Criteria

1. The Frontend shall `stakeholders/0` ドキュメントを `onSnapshot` で購読する `createStakeholdersStore` を新設する
2. The `createStakeholdersStore` shall `stakeholders: StakeholderDoc[]`・`isLoaded: boolean` を公開する
3. The `currentTopicStore` shall `stakeholdersStore` を保持・起動・停止する
4. The Phase1Stakeholders.svelte shall `topic.stakeholders` の代わりに `stakeholdersStore.stakeholders` からデータを参照する
5. When トピック画面から離脱する, the `currentTopicStore` shall `stakeholdersStore` を停止する

---

### Requirement 4: リセット処理・承認処理の更新

**Objective:** As a 開発者, I want ステークホルダーのリセット・承認操作が `stakeholders/0` ドキュメントを対象とする, so that `topic.stakeholders` フィールドへの依存が完全に除去される。

#### Acceptance Criteria

1. When ステークホルダーリセットが実行される, the Frontend shall `topic.stakeholders` フィールドのクリアではなく `stakeholders/0` ドキュメントの削除を行う
2. The `approveStakeholders` 処理 shall `topic.stakeholders` フィールドへの参照を持たない（`topic.phaseStatus` の更新のみ行う）
3. The Frontend shall `topic.stakeholders` を読み書きするコードをコードベースから除去する

---

### Requirement 5: Firestore セキュリティルールの更新

**Objective:** As a 開発者, I want `stakeholders/{docId}` のセキュリティルールを定義する, so that 認証済みユーザーのみが読み書きできる。

#### Acceptance Criteria

1. The Firestore rules shall `topics/{topicId}/stakeholders/{docId}` に対して認証済みユーザーの読み書きを許可する
2. The Firestore rules shall `stakeholders/{docId}` の未認証読み取りを許可しない（ステークホルダーは非公開データ）
