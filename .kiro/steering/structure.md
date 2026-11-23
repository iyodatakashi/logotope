# Project Structure

## Organization Philosophy

機能ドメイン（Admin操作 / 公開閲覧 / AI Pipeline / データ）で責務を分離する。フロントエンドとFirebase Functionsはそれぞれ独立したパッケージとして管理する。

## Directory Patterns

### フロントエンド（SvelteKit）

**構成の規約は全 SvelteKit プロジェクト共通のルール（`~/.claude/rules/sveltekit-structure.md`）に従う。** routes を最小ラッパーにする・`src/lib` の分け方・型の置き場所・命名・`#lib/` の import・テストの置き場所・過度な共通化をしない、はすべてそちらに書いてある。ここにはこのプロジェクトのドメインと例外だけを書く。

**features のドメイン**

| ドメイン | 画面 |
|---|---|
| `adminAuth/` | 管理者の認証（サインイン・登録・メール確認・パスワード再設定・パスワード変更）。画面の器 `AdminAuthTemplate` |
| `topics/` | 管理画面のトピック。一覧 `topicList/`、作成 `topicCreate/`、トピック詳細 `topicDetail/`（フェーズごとの画面 `theme/` `factResearch/` `personas/` `chapters/` `debate/` `editing/` `publish/` と、それらの器 `AdminTopicDetailTemplate`・`StepNav`）。管理画面のヘッダー `AdminTemplate` |
| `publishedArticles/` | 公開（閲覧者向け）の記事。一覧 `publishedArticleList/`、記事 `publishedArticleDetail/`（記事のエラー画面を含む） |
| `perspectiveHitTest/` | 開発用の切り分けページ（`/dev/perspective-hit-test`） |

**stores の中身**

- Firebase の初期化（`firebase.ts`・`firebaseConfig.ts`・公開読み取り専用の `firebasePublic.ts`）も外部サービスへの入口なので stores に置く
- 公開ページの取得（`publishedTopics.ts`・`publishedArticle.ts`）は購読を持たない1回きりの取得だが、Firestore へのアクセスなので stores に置く。runes を使わないので `.svelte.ts` にしない
- 管理画面の購読の開始・停止は階層ごとの `+layout.svelte` に束ねる（`admin/topics/+layout.svelte` で `topicsStore`、`admin/topics/[topicId]/+layout.svelte` で `currentTopicStore`）。認証ストアは `admin/+layout.svelte` の `AuthSession` が開始・停止する

**routes の補足**

- `+page.ts` の `load` は、features に置いた `loadXxx`（例 `loadPublishedArticleList`）を呼ぶだけにする。取得の失敗をどう画面に写すかは画面の仕様なので features に置き、テストもそちらに書く
- `admin/topics/[topicId]/+page.svelte` は中身を持たない。トピック直下の URL は `[topicId]/+layout.svelte` が現在フェーズの URL へ置き換える（到達の制御・リダイレクトは layout の役割）

**ルールから外れている所（例外）**

- **`#lib/` の import に拡張子を書く**（`#lib/stores/topics.svelte.ts`、`#lib/models/topic/topic.types.ts`）。`#lib` は `package.json` の `imports` で定めており、TypeScript はこの経路では拡張子を補わないため（napoleon など他のプロジェクトと同じ形）
- **`utils/` の関数が返す型は、その `utils` のファイルに置く**（`utils/inlineDiff.ts` の `InlineDiffSegment`）。`utils/` はドメインに依存しないので、`models/<domain>/` の型を参照させない
- **`src/tests/routes/` だけは `src/routes` の並びに置く**（`routes/admin/adminAuthPlacement.test.ts`）。認証の到達制御がどの階層に置かれているかを、route のファイルを読んで検査するテストで、対応する `src/lib` のファイルが無いため
- **`src/lib/server/` を使わない理由は静的ビルドではない。** このプロジェクトは `adapter-node` で SSR する（公開ページ）。公開ページのサーバー側の取得もクライアント SDK（`stores/firebasePublic.ts`）で行い、サーバー専用のコードを持たないため `src/lib/server/` は要らない

### Firebase Functions（バックエンド・AIパイプライン）
**Location**: `functions/src/`  
**Purpose**: AI生成処理・APIエンドポイント・Firebase Admin操作  

```
functions/src/
├── index.ts                    # Functions エクスポートエントリポイント
├── api/                        # HTTPエンドポイント（onCall / onTaskDispatched）
│   ├── chapters.ts
│   ├── debates.ts
│   ├── interviews.ts
│   ├── personas.ts
│   └── stakeholders.ts
├── agents/                     # マルチエージェント構造
│   ├── facilitator-agent.ts
│   └── persona-agent.ts
├── constants/
│   ├── ai.constants.ts
│   ├── debate.constants.ts
│   └── writing-style.constants.ts  # 文体（口語／散文／内部メモ）の単一定義元
├── llm/
│   └── models.ts
├── pipeline/                   # AI生成パイプライン（ドメイン別サブディレクトリ）
│   ├── chapters/
│   │   └── chapter-generator.ts
│   ├── debate/
│   │   ├── debate-lifecycle.ts
│   │   ├── debate-orchestrator.ts
│   │   ├── debate-state.ts
│   │   ├── engagement.ts
│   │   ├── intervention.ts
│   │   ├── queued-intents.ts
│   │   ├── speaker-selection.ts
│   │   ├── turn.ts
│   │   └── utils.ts
│   ├── interviews/
│   │   └── interview-runner.ts
│   ├── personas/
│   │   └── personas.ts
│   ├── stakeholders/
│   │   └── stakeholder-generator.ts
│   └── topics/
│       └── topics.ts
├── search/
│   └── search-service.ts
├── types/                      # Functions共通型定義（ドメイン別分割）
│   ├── chapter.types.ts
│   ├── common.types.ts
│   ├── debate.types.ts
│   ├── interview.types.ts
│   ├── persona.types.ts
│   ├── stakeholder.types.ts
│   └── topic.types.ts
└── utils/
    ├── auth.ts
    └── prompt-formatters.ts
```

### Firebase Data Connect（データスキーマ）
**Location**: `dataconnect/`  
**Purpose**: PostgreSQLスキーマ定義とGraphQLコネクター  

```
dataconnect/
├── schema/schema.gql           # データモデル定義
└── connector/
    ├── connector.yaml
    ├── queries.gql
    └── mutations.gql
```

## Naming Conventions

SvelteKit 側（`src/`）の命名は共通ルールに従う。ここには Functions とデータの命名だけを書く。

- **Functions の TypeScript ファイル**: kebab-case（例: `debate-orchestrator.ts`）。共通ルールの camelCase は SvelteKit 側だけに当てはまる
- **GraphQL型**: PascalCase（例: `DebateTopic`, `PersonaProfile`）
- **Firestore 永続型の `*ForFirestore` / 素の名前の使い分け**は Functions 側（`functions/src/types/`）でも同じにする

## 型定義の置き場所（Functions 側）

フロント（`src/lib`）の型の規約は共通ルールに従う。Functions 側（`functions/src`）の型は `functions/src/types/` に置いてよい。`.types.ts` に型と型ガードだけを置く・変換関数を置かない・`*ForFirestore` を境界でだけ触る、は Functions 側でも同じにする。

## 公開（閲覧）用の型と部品

公開（閲覧者向け）専用の型に `Published` 接頭辞を付けることは共通ルールにある（例: `PublishedTopic` / `PublishedArticle` / `PublishedChapter`）。このプロジェクトでは次も守る。

- **`Published*` は読み取り専用の最小射影とし、表示に必要なフィールドだけを持たせる。** 公開部品・データ取得の出力型はこの `Published*` を使う
- **共用できる型は共用する。** Admin と本当に共通な型を、公開専用として重複定義しない。Firestore の読み取り入力は、境界で `doc.data() as XxxForFirestore` として Admin の永続型を cast 参照し、その場で `Published*` へ射影する。「公開だから Admin 型に一切触れるな」という機械的分離はしない
- **管理機能の巨大なミューテーション面を公開の読み取り経路へ引き込まない**（`createTopic` が返す `TopicStates`・管理用の stores など）。分離が意味を持つのはこの一点
- 公開部品を作る際、既存の管理用コンポーネントを「見た目が同じだから」と丸ごと流用しない。見た目の踏襲は可

## CSS / スタイル記法

- **BEM記法で書く**（Block・Element `__`・Modifier `--`）。
  - 例: `.persona-item`（Block）、`.persona-item__header`（Element）、`.persona-item__badge--active`（Modifier）
- **Block名はコンポーネントのPascalCase名をkebab-caseに変換する**。
  - 例: `PersonaItem.svelte` → `.persona-item`、`PhasePanel.svelte` → `.phase-panel`
- **`+page.svelte` / `+layout.svelte` が例外的にマークアップを持つ場合は、場所が分かるBlock名にする**。場所を表す接頭辞 + `-page` / `-layout` とする。
  - 例: `admin/+layout.svelte` → `.admin-layout`
- **見た目のための修飾タグ（`<strong>` / `<b>` / `<em>` / `<i>` / `<u>` / `<small>` / `<mark>` など）を使わない**。リセットCSSでこれらの既定スタイルはリセットされており、視覚的な意味を持たない。強調・装飾はクラス（BEMのElement／Modifier）とCSSで表現する。
  - 例: `<strong>重要</strong>` ではなく `<span class="notice__emphasis">重要</span>` のようにクラスで指定する。
  - 見出し・段落・リストなど**文書構造を表すタグ（`<h1>`〜`<h6>` / `<p>` / `<ul>` / `<li>` など）は従来どおり使ってよい**。禁止するのは「見た目のためだけのインライン修飾タグ」。

## Code Organization Principles

- フロントエンドからFirebase Adminへの直接アクセス禁止（必ずFunctions経由）
- AI処理ロジックはすべて `functions/src/pipeline/` または `functions/src/agents/` に配置
- 型の重複を避けるため、共通型はFunctions側で定義してAPIレスポンスとして渡す

---
_Document patterns, not file trees. New files following patterns shouldn't require updates_
