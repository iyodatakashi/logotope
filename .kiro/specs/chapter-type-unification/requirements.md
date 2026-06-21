# Requirements Document

## Introduction

`src/lib/models/`（FE）と `functions/src/types/`（functions）の両側で、Firestore 永続型に `*Doc` サフィックスが使われているが、このサフィックスは「Firestore ドキュメント型」であることを明示しない成り行き命名である。また、Timestamp を含む型に対してアプリケーション内で使用する Date 変換版が定義されていない型が複数存在し、型安全性と可読性が低い。

本仕様は以下の2点を実施する。
1. Firestore 永続型を `*ForFirestore` サフィックスに統一する
2. Timestamp を含む型に対してアプリケーション型（Date 版）を追加し、ストア変換を整備する

## Boundary Context

- **In scope**: `src/lib/models/` 配下の全 `*Doc` 型のリネーム、Timestamp含有型のアプリ型追加、`personas.svelte.ts` の Timestamp→Date 変換、`functions/src/types/` 内の `ChapterStateData`・`ChapterAnalysisDoc`・`DiscussionPointState` の命名整理、これらを参照する全ストア・テスト・コンポーネントのインポート更新
- **Out of scope**: 型の構造変更・フィールド追加削除、Firestore セキュリティルール変更、新機能追加、`Topic` / `createTopicStates` の Timestamp 変換（既存の Svelte state パターンで対応済み）
- **Adjacent expectations**: `chapter-grouping-separation` 実装完了後に着手する（同一ファイルへの衝突回避）。ステアリング「FE と functions の型ファイル分離ルール」は維持する

## Requirements

### Requirement 1: Firestore永続型の `ForFirestore` 命名統一

**Objective:** As a 開発者, I want Firestore ドキュメント型が `*ForFirestore` サフィックスで統一されていること, so that 型名を見るだけでその型が Firestore との境界型であることが分かり、アプリ内型との区別が明確になる

#### Acceptance Criteria

1. The 型システム shall `TurnDoc`・`ChapterDoc`・`ChapterAnalysisDoc`・`PersonaDoc`・`BeliefDoc`・`InterviewDoc`・`TopicDoc`・`FetchedSourceContent`・`StakeholderDoc`・`EngagementDoc`・`PostDebateCommentDoc`・`PostDebateCommentsDoc`・`DiscussionPointStatusDoc` の全型を `*ForFirestore` サフィックスに改名する
2. The 型システム shall リネーム後の型を参照する全ファイル（ストア・コンポーネント・テスト）のインポートパスと型アノテーションを更新する
3. The 型システム shall `functions/src/types/debate.types.ts` の `ChapterStateData` を `ChapterForFirestore` に改名し、FE 側の `ChapterForFirestore` と命名を統一する
4. The 型システム shall `functions/src/types/chapter.types.ts` の `ChapterAnalysisDoc` を `ChapterAnalysisForFirestore` に改名する
5. The 型システム shall FE 側に re-export やエイリアスを残さず、参照側のインポートを直接書き換える

### Requirement 2: Timestamp含有型のアプリケーション型追加

**Objective:** As a 開発者, I want Timestamp を含む Firestore 型に対してアプリ内で使用する Date 変換型が定義されていること, so that アプリケーションロジックが Firestore の Timestamp に直接依存せず、型安全な Date 値を扱える

#### Acceptance Criteria

1. The 型システム shall `BeliefForFirestore`（`createdAt: Timestamp`）に対して、`createdAt: Date` を持つ `Belief` 型を定義する
2. The 型システム shall `InterviewForFirestore`（`completedAt?: Timestamp`）に対して、`completedAt?: Date` を持つ `Interview` 型を定義する
3. The 型システム shall `FetchedSourceContentForFirestore`（`fetchedAt: Timestamp`）に対して、`fetchedAt: Date` を持つ `FetchedSourceContent` 型を定義する
4. The 型システム shall アプリ型（`Belief`・`Interview`・`FetchedSourceContent`）を `Omit<*ForFirestore, '日付フィールド'> & { 日付フィールド: Date }` パターンで定義し、`TurnDoc`/`Turn` の既存パターンと整合させる
5. The 型システム shall Timestamp を含まない型（`ChapterForFirestore`・`ChapterAnalysisForFirestore`・`StakeholderForFirestore`・`EngagementForFirestore` 等）はアプリ型を別途定義しない

### Requirement 3: PersonaForFirestore / Persona のカスケード型定義とストア変換

**Objective:** As a 開発者, I want `Persona` 型（Date版）が定義されストアが変換を行うこと, so that アプリ内のペルソナ操作が Timestamp ではなく Date 値を扱い、型安全性が確保される

#### Acceptance Criteria

1. The 型システム shall `PersonaForFirestore` を `beliefs: BeliefForFirestore[]` と `interview?: InterviewForFirestore` を持つ型として定義する
2. The 型システム shall `Persona` を `beliefs: Belief[]` と `interview?: Interview` を持つアプリ型として定義する
3. When `personas.svelte.ts` が Firestore から `PersonaForFirestore` を読み取ったとき, the personasStore shall `BeliefForFirestore.createdAt`（Timestamp）を `Date` に変換し `Belief` 型に変換して `Persona` として保持する
4. When `personas.svelte.ts` が Firestore から `PersonaForFirestore` を読み取ったとき, the personasStore shall `InterviewForFirestore.completedAt`（Timestamp）が存在する場合 `Date` に変換し `Interview` 型に変換して `Persona` として保持する
5. The personasStore shall `Persona` 型の配列をアプリ内に公開し、Timestamp を外部に露出しない

### Requirement 4: `DiscussionPointState` / `DiscussionPointStatusDoc` の命名統一

**Objective:** As a 開発者, I want FE と functions で同じ概念を同じ型名で表現すること, so that 両側のコードを読む際の認知負荷が減る

#### Acceptance Criteria

1. The 型システム shall FE 側の `DiscussionPointStatusDoc` と functions 側の `DiscussionPointState` を同一の型名に統一する
2. The 型システム shall この型は Timestamp を含まないため `ForFirestore` サフィックスを付けない
3. The 型システム shall functions 側の `DebateState.discussionPoints` と `ChapterForFirestore.discussionPointStatuses` の両方で同一型名を使用できるよう命名を選定する
4. When リネームを実施したとき, the 型システム shall 両側の型定義ファイル・テストファイルのインポートを更新する

### Requirement 5: 非退行保証

**Objective:** As a 開発者, I want 命名変更後も既存の型チェックとテストが全件通過すること, so that リファクタリングによる実装バグの混入がないことを確認できる

#### Acceptance Criteria

1. The 型システム shall リネーム完了後に `pnpm exec svelte-check` または `pnpm exec tsc --noEmit` を実行したとき、型エラーがゼロである
2. The 型システム shall `pnpm test:unit` を実行したとき全件通過しゼロ失敗である
3. If 既存のテストが命名変更後に失敗したとき, the 型システム shall テストのインポートと型アノテーションを更新して失敗をゼロにする
4. The 型システム shall 型の構造（フィールド名・フィールド型・省略可否）をリネーム以外の理由で変更しない
