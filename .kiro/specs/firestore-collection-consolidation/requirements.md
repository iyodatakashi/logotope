# Requirements Document

## Introduction

logotope の Firestore には `topics`・`progress`・`debate_progress` という3つのコレクションが存在するが、実態は以下のとおりである。

- **`progress`**: `ProgressTrackerService` が書き込むが、フロントエンドのどのストア・コンポーネントからも読まれていない。`topics/{topicId}.status` がトピック状態の唯一の信頼できるソースであり、二重管理になっている。
- **`debate_progress`**: 統合テスト (`progress-tracker.integration.test.ts`) にのみ登場するが、実装コード (`progress-tracker.ts`) は `collection('progress')` に書いており、テストが誤ったコレクション名を参照しているバグである。実際には存在しない。

この2コレクションを廃止し、`topics` コレクションに一本化することで Firestore スキーマをシンプルにし、コード・テスト間の不整合を解消する。

## Boundary Context

- **In scope**:
  - `functions/src/pipeline/progress-tracker.ts` の削除
  - `functions/src/pipeline/debate-orchestrator.ts` から `ProgressTrackerService` の参照を削除
  - `functions/src/pipeline/progress-tracker.integration.test.ts` の削除
  - `.kiro/steering/firebase.md` の `debate_progress` 記述の削除
- **Out of scope**:
  - `topics/{topicId}` のドキュメント構造変更（フィールド追加なし）
  - フロントエンド (`src/`) コードの変更（`progress` を読んでいないため不要）
  - Firestore セキュリティルールの変更（`progress`・`debate_progress` はすでに deny されている）
  - AI パイプライン内部ロジックの変更

---

## Requirements

### Requirement 1: `progress` コレクションへの書き込み廃止

**Objective:** As a 開発者, I want `ProgressTrackerService` を削除して `progress` コレクションへの書き込みを廃止したい, so that 未使用の Firestore コレクションが消え、データの流れがシンプルになる

#### Acceptance Criteria

1. The Debate Orchestrator shall `ProgressTrackerService` をインスタンス化せずに討論処理を完了できる
2. When 討論パイプラインが開始されたとき, the Debate Orchestrator shall `tracker.updateStatus()` を呼び出さずに動作する
3. The system shall `functions/src/pipeline/progress-tracker.ts` ファイルが存在しない状態でビルドエラーなく正常にビルドできる
4. The system shall `progress/{topicId}` コレクションへの書き込みが発生しない

### Requirement 2: `debate_progress` コレクション参照バグの修正

**Objective:** As a 開発者, I want テストコード内の誤ったコレクション名参照を解消したい, so that 存在しないコレクションを参照するデッドコードが除去される

#### Acceptance Criteria

1. The system shall `progress-tracker.integration.test.ts` が存在しない状態でテストスイートが正常に実行できる
2. The system shall `debate_progress` コレクション名を参照するコードがリポジトリ内に存在しない
3. When テストを実行したとき, the system shall `progress-tracker.integration.test.ts` に起因するテスト失敗が発生しない

### Requirement 3: ステアリングドキュメントの整合性維持

**Objective:** As a 開発者, I want プロジェクトの設計ドキュメントを実装と一致させたい, so that AI や新規開発者が誤ったコレクション情報を参照しない

#### Acceptance Criteria

1. The system shall `.kiro/steering/firebase.md` の Firestore スキーマ定義から `debate_progress/{topicId}` の記述が除去されている
2. The system shall `firebase.md` に記載されたコレクション構造と実際の実装コードが一致している
