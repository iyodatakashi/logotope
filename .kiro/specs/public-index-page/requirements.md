# Requirements Document

## Introduction

閲覧者（一般ユーザー）が公開済みの討論記事を見つけるための入口となる、公開インデックスページを作成する。本ページは**記事インデックス（公開済み討論記事の一覧）を主役**とし、閲覧者が読みたい記事を選んで読み始められることを最優先の目的とする。

サービスの説明（このサイトが何であるか）は別ページ（About／サイト説明ページ）で扱う方針とし、本インデックスページには据えない。本ページはあくまで記事一覧の玄関口に徹する。

現状の `src/routes/+page.svelte` は最小限のプレースホルダ（見出し・タグライン・素朴な一覧）であり、公開判定は publish-phase で導入済みの `published` フラグに寄せ替え済みである。本仕様では、このページを記事インデックス中心の正式なインデックスページとして成立させる。

## Boundary Context

- **In scope**:
  - 公開済み討論記事を一覧する公開インデックスページ（ルート `/` ＝ `src/routes/+page.svelte`）の作成・刷新（記事インデックスが主役）
  - 未認証の閲覧者を前提とした表示とデータ取得
  - 共有／検索向けメタ情報、取得状態（読み込み中・空・失敗）の表示、レスポンシブ表示
- **Out of scope**:
  - サービス説明（About／サイト説明）ページ — 別ページ・別仕様で扱う。本インデックスページには据えない
  - 個々の討論の公開閲覧ページ（記事ページ `/articles/[topicId]`）の新設・変更（別仕様で扱う）
  - 検索・絞り込み・カテゴリ分類・ページネーション（本仕様では扱わない）
  - 管理（admin）側の画面、公開 ON/OFF 操作（publish-phase で実装済み）
- **Adjacent expectations**:
  - 公開判定は publish-phase で導入済みの `published` フラグに従う（`publishedAt` は日時表示専用）
  - firestore.rules は `published == true` の討論のみを一般（未認証）読み取り許可する既存前提に従う
  - 一覧項目のリンク先である記事ページの URL は `/articles/[topicId]`（`topicId` はトピックの id）とする。記事ページ自体は本仕様外で別途提供される想定であり、本インデックスページはその入口リンクのみを提供する（現状の `/debate/[id]` リンクは `/articles/[topicId]` へ改める）

- **Design constraints（公開型の分離）**:
  - 公開（閲覧）側のアプリ層データ型は Admin 用の型（`Topic` / `TopicStates` / `*ForFirestore`）と**名前も定義も完全に分離**する。公開側の型には必ず **`Published` 接頭辞**を付ける（本仕様の型は `PublishedTopic`。後続の公開仕様も `PublishedArticle` / `PublishedChapter` … と統一）
  - 公開コンポーネントおよび公開データ取得は **`Published*` 型のみに依存**し、`TopicStates` / `topicsStore` / `createTopicStates` / `*ForFirestore` には依存しない。射影は読み込み境界で `topics` ドキュメント → `PublishedTopic` に変換する（Admin 型を経由しない）
  - 本仕様のインデックス用読み取りモデルは **`PublishedTopic = { id, title, publishedAt }`**（読み取り専用の最小射影。`published` は公開クエリが保証するため型には載せない）

## Requirements

### Requirement 1: 公開済み討論の一覧表示

**Objective:** 閲覧者として、公開されている討論を一覧で見つけたい。多様な立場の意見に触れる入口を得るため。

#### Acceptance Criteria

1. The 公開インデックスページ shall `published` が true の討論のみを一覧に表示する。
2. The 公開インデックスページ shall 一覧を公開日時（`publishedAt`）の新しい順に並べる。
3. Where 一覧の各項目, the 公開インデックスページ shall 討論記事のタイトルと公開日を表示する。
4. When 閲覧者が一覧の項目を選択する, the 公開インデックスページ shall その討論の記事ページ（`/articles/[topicId]`）への遷移導線を提供する。
5. The 公開インデックスページ shall 非公開（`published` が false または未設定）の討論を一覧に表示しない。

### Requirement 2: 未認証の閲覧者アクセス

**Objective:** 閲覧者として、ログインせずに公開討論の一覧を閲覧したい。誰でも自由に多様な意見へアクセスできるようにするため。

#### Acceptance Criteria

1. The 公開インデックスページ shall 認証（ログイン）なしで表示できる。
2. While 閲覧者が未認証である, the 公開インデックスページ shall 公開済み討論のみを取得対象とし、非公開データを要求しない。
3. The 公開インデックスページ shall 管理（admin）機能への導線を閲覧者向け表示に含めない。

### Requirement 3: 取得状態の表示

**Objective:** 閲覧者として、読み込み中・データ無し・取得失敗の状態を明確に知りたい。画面が無言で固まらないようにするため。

#### Acceptance Criteria

1. While 一覧データを取得中である, the 公開インデックスページ shall 読み込み中であることを示す表示を出す。
2. If 公開済みの討論が1件も無い, then the 公開インデックスページ shall 公開討論がまだ無い旨のメッセージを表示する。
3. If 一覧データの取得に失敗する, then the 公開インデックスページ shall 取得に失敗した旨を閲覧者に伝える。

### Requirement 4: ページのメタ情報

**Objective:** 閲覧者として、共有・検索の際にこのインデックスページが適切に表現されてほしい。記事一覧への到達性を高めるため。

#### Acceptance Criteria

1. The 公開インデックスページ shall ページのタイトル・説明・OGP 等のメタ情報を提供する。
2. The 公開インデックスページ shall サービスの説明文（About 相当）を主要コンテンツとして表示しない（記事インデックスを主役とし、説明は別ページに委ねる）。

### Requirement 5: レスポンシブ表示

**Objective:** 閲覧者として、PC でもスマートフォンでも読みやすく一覧を見たい。利用環境を問わず快適に閲覧するため。

#### Acceptance Criteria

1. The 公開インデックスページ shall 画面幅に応じてレイアウトを調整し、モバイルとデスクトップの双方で一覧を読みやすく表示する。
