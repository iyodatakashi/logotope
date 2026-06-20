# Requirements Document

## Project Description (Input)
現在の `chaptersStore`（1トピックの全チャプターを1ストアで配列管理）と `engagementsStore`（シングルトンで `setChapterId()` によりチャプターを切り替え）の設計を見直す。

チャプターごとに独立した `chapterStore` インスタンスと `engagementsStore` インスタンスを作成するリファクタリング。

- `ChapterWithId`（`ChapterStateDoc & { id: string }` の単純データ型）は配列管理設計の産物であり廃止対象
- `createChapterStore(...)` をチャプター単位で作成する
- `createEngagementsStore(...)` をチャプター単位で作成する（`setChapterId` を廃止）
- `currentTopicStore` の `$effect.root` と `engagementsStore` シングルトンを削除する
- 2つのストアは独立したインスタンスとして別々に管理する（一方が他方を内包しない）

## Introduction

本仕様は、討論チャプターとそのエンゲージメント評価を扱うクライアント側ストア構造のリファクタリングを定義する。現状は「1トピックの全チャプターを単一の `chaptersStore` が配列で保持」し、「単一の `engagementsStore` シングルトンが `setChapterId()` で購読対象チャプターを切り替える」設計になっている。この切り替えを成立させるために `currentTopicStore` がモジュールレベルで `$effect.root` を張り、実行中チャプターを監視してエンゲージメントストアに注入している。

この構造は、(1) チャプターを跨いで同一ストアインスタンスを使い回す歪み、(2) シングルトンへの命令的なチャプターID注入、(3) モジュールトップレベルでの `$effect.root` 使用、という複数の複雑さを生んでいる。

本リファクタリングでは、チャプターを「独立したストアインスタンスの単位」として再定義し、`chapterStore` と `engagementsStore` をそれぞれチャプター単位で生成する。両者は互いを内包せず独立して生成・管理される。これにより `setChapterId`・`$effect.root`・`ChapterWithId` を廃止する。Firestore のデータ構造・UI/UX・討論生成ロジックは変更しない（純粋な内部構造の整理）。

## Boundary Context

- **In scope**:
  - `src/lib/stores/chapters.svelte.ts` のチャプター単位インスタンス化
  - `src/lib/stores/engagements.svelte.ts` のチャプター単位インスタンス化と `setChapterId` 廃止
  - `ChapterWithId` 型の廃止
  - `currentTopic.svelte.ts` からの `$effect.root` とシングルトン `engagementsStore` 除去
  - 消費側（`Phase5Debate.svelte`、公開ページ `routes/topics/[topicId]/+page.svelte`）の参照更新
  - 関連ユニットテスト（`engagements.test.ts`、`chapters.test.ts`、`Phase5Debate.svelte.spec.ts` 等）の更新
- **Out of scope**:
  - Firestore のコレクション構造・ドキュメントスキーマの変更（`topics/{topicId}/chapters/{chapterId}` および `.../engagements/{personaId}` は現状維持）
  - Firebase Functions 側の討論オーケストレーション・エンゲージメント評価ロジック
  - UI の表示内容・レイアウト・操作フローの変更
  - 他フェーズストア（personas / postDebateComments / chapterAnalysis / stakeholders）の構造変更
- **Adjacent expectations**:
  - `per-chapter-engagements` 仕様により、エンゲージメントは既に Firestore 上でチャプタースコープのサブコレクション（`topics/{topicId}/chapters/{chapterId}/engagements`）へ移行済みである。本仕様はそのデータ構造を前提に、クライアント側ストアの持ち方のみを整理する。
  - チャプターの一覧と順序（`chapterIndex` 昇順）は、どのインスタンスが集約を担うかを設計フェーズで決定する。本要件では「一覧と順序が消費側に提供され続けること」を保証する。

## Requirements

### Requirement 1: チャプター単位の chapterStore インスタンス化
**Objective:** As a フロントエンド開発者, I want 各チャプターを独立した `chapterStore` インスタンスで表現する, so that チャプター間で単一ストアを使い回す構造的な歪みを排除できる

#### Acceptance Criteria
1. The チャプターストアモジュール shall 1チャプター分の状態（`chapterIndex`・`title`・`focusQuestion`・`discussionPoints`・`turns`・`discussionPointStatuses`・`status`・`id`）を保持する `chapterStore` インスタンスを生成する生成関数を提供する。
2. When 同一トピックに複数チャプターが存在する, the チャプターストアモジュール shall チャプターごとに別個の `chapterStore` インスタンスを保持する。
3. The チャプターストアモジュール shall チャプター一覧を `chapterIndex` 昇順で消費側に提供する。
4. The チャプターストアモジュール shall 実行中（`status === 'running'`）のチャプターを特定する手段を提供する。
5. The チャプターストアモジュール shall 全チャプターのターンを連結した一覧（現 `turns` 相当）を消費側に提供する。

### Requirement 2: チャプター単位の engagementsStore インスタンス化
**Objective:** As a フロントエンド開発者, I want エンゲージメントストアをチャプター単位のインスタンスとして生成する, so that シングルトンへの命令的なチャプターID切り替えを廃止できる

#### Acceptance Criteria
1. The エンゲージメントストアモジュール shall 特定の1チャプターのエンゲージメントサブコレクション（`topics/{topicId}/chapters/{chapterId}/engagements`）を購読する `engagementsStore` インスタンスを生成する生成関数を提供する。
2. The エンゲージメントストアモジュール shall `setChapterId` メソッドを提供しない（廃止する）。
3. When エンゲージメントストアインスタンスが購読を開始する, the エンゲージメントストア shall 対象チャプターの各ペルソナ履歴を `turnId` 文字列キーでグループ化した `engagementsMap` を公開する。
4. When エンゲージメントストアインスタンスが停止される, the エンゲージメントストア shall 当該チャプターの Firestore 購読を解除する。
5. The エンゲージメントストアモジュール shall 既存の `buildEngagementsMap` の純粋関数としての振る舞い（空入力・複数ペルソナのグループ化・文字列キー保持）を維持する。

### Requirement 3: ChapterWithId 型の廃止
**Objective:** As a フロントエンド開発者, I want 配列管理設計の産物である `ChapterWithId` 型を廃止する, so that データ型がストア構造の都合を引きずらない状態にする

#### Acceptance Criteria
1. The コードベース shall `ChapterWithId` 型を定義・公開しない。
2. While 既存コードが `ChapterWithId` を参照している, the リファクタリング shall その参照を新しいチャプター表現（`chapterStore` インスタンスまたは適切なデータ型）へ置き換える。
3. If チャプターの永続データ表現が必要な箇所がある, then the コードベース shall `ChapterStateDoc` 等の既存ドメインデータ型を用いる。

### Requirement 4: currentTopicStore からのシングルトン・$effect.root 除去
**Objective:** As a フロントエンド開発者, I want `currentTopicStore` のモジュールレベル `$effect.root` とシングルトン `engagementsStore` を除去する, so that ストアの初期化が宣言的かつ単純になる

#### Acceptance Criteria
1. The `currentTopicStore` shall モジュールレベルで `$effect.root` を使用しない。
2. The `currentTopicStore` shall 単一のシングルトン `engagementsStore` を保持・公開しない。
3. While 討論が実行中である, the ストア構造 shall 実行中チャプターのエンゲージメントを消費側へ提供する手段を、命令的なチャプターID注入なしで提供する。
4. The `currentTopicStore` shall リファクタリング後も既存の公開アクセサ（`topic`・`chaptersStore`・`personasStore` 等）の利用契約を維持する。

### Requirement 5: chapterStore と engagementsStore の独立性
**Objective:** As a フロントエンド開発者, I want `chapterStore` と `engagementsStore` を互いに内包しない独立したインスタンスとして生成する, so that 各ストアの責務とライフサイクルが分離される

#### Acceptance Criteria
1. The `chapterStore` shall `engagementsStore` インスタンスを内部に保持・生成しない。
2. The `engagementsStore` shall `chapterStore` インスタンスを内部に保持・生成しない。
3. When あるチャプターの `chapterStore` と `engagementsStore` が必要になる, the ストア構造 shall それぞれを独立した生成関数の呼び出しで生成する。
4. The ストア構造 shall いずれか一方のデータ型（例: `ChapterStateDoc`）にもう一方のストアを混在させない。

### Requirement 6: 既存の表示・ライフサイクル挙動の維持
**Objective:** As a 利用者（管理者・閲覧者）, I want リファクタリング前後で討論画面の表示と購読ライフサイクルが変わらない, so that 内部構造の変更が利用体験に影響しない

#### Acceptance Criteria
1. The 管理討論画面（`Phase5Debate.svelte`）shall リファクタリング後も各ターンの発言・話者・エンゲージメント・信念変化・チャプター進捗を従来どおり表示する。
2. The 公開討論ページ（`routes/topics/[topicId]/+page.svelte`）shall リファクタリング後もチャプター一覧・ターン・公開コメントを従来どおり表示する。
3. When 討論画面がマウントされる, the ストア構造 shall 必要な Firestore 購読を開始する。
4. When 討論画面がアンマウントされる, the ストア構造 shall 開始した全ての Firestore 購読を解除し、購読リークを発生させない。
5. While 討論が進行し実行中チャプターが切り替わる, the エンゲージメント表示 shall 実行中チャプターのエンゲージメントを反映する。

### Requirement 7: テストの更新
**Objective:** As a フロントエンド開発者, I want 既存テストを新ストア構造に追従させる, so that リファクタリング後も振る舞いが検証可能な状態を保つ

#### Acceptance Criteria
1. The エンゲージメントストアのテスト shall `setChapterId` ベースの検証を、チャプター単位インスタンス生成・購読・停止の検証へ置き換える。
2. The `Phase5Debate.svelte.spec.ts` shall `setChapterId` を含むモックを、新しいストア構造に対応したモックへ更新する。
3. The チャプターストアのテスト shall チャプター単位インスタンスの生成・一覧・順序・実行中チャプター特定の振る舞いを検証する。
4. When リファクタリング後にユニットテストを実行する, the テストスイート shall 全テストがパスする。
