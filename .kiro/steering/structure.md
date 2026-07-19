# Project Structure

## Organization Philosophy

機能ドメイン（Admin操作 / 公開閲覧 / AI Pipeline / データ）で責務を分離する。フロントエンドとFirebase Functionsはそれぞれ独立したパッケージとして管理する。

## Directory Patterns

### フロントエンド（SvelteKit）
**Location**: `src/`  
**Purpose**: 静的ビルドされるSvelteKitアプリケーション  

```
src/
├── routes/
│   ├── +layout.svelte          # グローバルレイアウト
│   ├── +page.svelte            # 公開トップ（討論一覧）
│   ├── debate/
│   │   └── [id]/+page.svelte   # 討論閲覧ページ（公開）
│   └── admin/
│       ├── +layout.svelte      # 管理者レイアウト（認証ガード）
│       ├── +page.svelte        # 管理ダッシュボード
│       ├── topics/
│       │   ├── +page.svelte    # テーマ一覧
│       │   └── new/+page.svelte
│       └── debate/
│           └── [id]/+page.svelte  # 討論管理・生成進捗
├── lib/
│   ├── components/
│   │   ├── admin/              # 管理者専用コンポーネント
│   │   └── public/             # 公開閲覧用コンポーネント
│   ├── stores/                 # Svelteストア（クライアント状態）
│   ├── api/                    # Firebase Functions呼び出しクライアント
│   └── types/
│       └── index.ts            # フロントエンド共通型定義
└── app.html
```

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
│   └── debate.constants.ts
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

- **Svelteコンポーネント**: PascalCase（例: `DebateViewer.svelte`）
- **TypeScriptファイル**: kebab-case（例: `debate-orchestrator.ts`）
- **ルートファイル**: SvelteKit規約に従う（`+page.svelte`, `+layout.svelte`）
- **型定義**: PascalCase（例: `DebateSession`, `PersonaBelief`）
- **GraphQL型**: PascalCase（例: `DebateTopic`, `PersonaProfile`）

## 公開（閲覧）型と管理（Admin）型の分離（重要）

公開（閲覧者向け）のアプリ層データ型は、管理（Admin）側の型と**名前も定義も完全に分離**する。混在させると、管理機能の巨大なミューテーション面（`createTopicStates` が返す `TopicStates` 等）が公開の読み取り経路に型依存として持ち込まれ、結合・歪みの原因になる。

- **公開側の型には必ず `Published` 接頭辞を付ける**（例: `PublishedTopic` / `PublishedArticle` / `PublishedChapter`）。読み取り専用の最小射影とし、表示に必要なフィールドだけを持たせる。
- **公開のコンポーネント・データ取得は `Published*` 型のみに依存する**。管理用の型・ストア（`Topic` / `TopicStates` / `topicsStore` / `createTopicStates` / `*ForFirestore`）には依存しない。
- Firestore コレクションは共有しうるが、**読み込み境界で永続ドキュメント → `Published*` に射影して変換**する（Admin 型を経由しない）。
- 公開部品を作る際、既存の管理用コンポーネントを「見た目が同じだから」と型ごと流用しない。見た目の踏襲は可、型・データ経路の共有は不可。

## CSS / スタイル記法

- **BEM記法で書く**（Block・Element `__`・Modifier `--`）。
  - 例: `.persona-item`（Block）、`.persona-item__header`（Element）、`.persona-item__badge--active`（Modifier）
- **Block名はコンポーネントのPascalCase名をkebab-caseに変換する**。
  - 例: `PersonaItem.svelte` → `.persona-item`、`PhasePanel.svelte` → `.phase-panel`
- **`+page.svelte` / `+layout.svelte` が例外的にマークアップを持つ場合（→「routes は最小限のラッパーにする」参照）は、場所が分かるBlock名にする**。場所を表す接頭辞 + `-page` / `-layout` とする。
  - 例: `admin/+layout.svelte` → `.admin-layout`

## Import Organization

```typescript
// 外部ライブラリ
import { Component } from '@14ch/svelte-ui';

// パスエイリアス（$lib = src/lib/）
import type { DebateSession } from '$lib/types';
import { debateApi } from '$lib/api/debates';

// 相対インポート（同一ディレクトリ内）
import { formatTurn } from './utils';
```

**Path Aliases**:
- `$lib/`: `src/lib/` にマップ（SvelteKit標準）

## routes（`+page.svelte` / `+layout.svelte`）は最小限のラッパーにする（重要）

`+page.svelte` / `+layout.svelte` はファイル名が全階層で同一で、**どの階層のファイルかはディレクトリ位置でしか識別できない**。中身にロジックやマークアップを書き込むと、コードから場所を辿れず開発効率を著しく下げる。

- **原則: routes 配下のファイルは、対応する feature コンポーネントを1つ import して差し込むだけの最小ラッパーにする**。画面の実体は `src/lib/features/**` の名前付きコンポーネント（`XxxPage.svelte` など）に置く。ファイル名（＝コンポーネント名）で場所と役割が一目で分かる状態を保つ。
- **例外（理由があれば `+layout.svelte` にコードを書いてよい）**:
  - store のライフサイクル（開始/終了）をその階層に束ねる（`$effect` で `store.start()` → cleanup を返す）
  - 配下の全ページで常時表示し続けるべきナビゲーション等、レイアウトに恒久的に属する要素
  - 到達ガード・リダイレクトなど、その階層に属する制御ロジック
- 例外で書く場合も、**表示の実体はできる限り feature コンポーネントへ寄せ**、レイアウトはデータライフサイクルと制御に絞る。

## Code Organization Principles

- フロントエンドからFirebase Adminへの直接アクセス禁止（必ずFunctions経由）
- `src/lib/server/` はSvelteKitのサーバーサイド機能（使用しない。静的ビルドのため）
- AI処理ロジックはすべて `functions/src/pipeline/` または `functions/src/agents/` に配置
- 型定義はフロントエンド用（`src/lib/types/`）とFunctions用（`functions/src/types/`）を分離し、重複を避けるために共通型はFunctions側で定義してAPIレスポンスとして渡す

## 過度な共通化・抽象化をしない（重要）

UIの一貫性は「同じ仕様であること」で担保する。**共通の部品やディスパッチャに各画面の分岐を吸わせて担保しようとしない**。後から1画面だけ調整したいときに、全画面に影響する共通物を触ることになり、非合理的。

- **画面の操作（アクション・遷移）は、その画面のコンポーネントに直接書く**。「フェーズ番号で分岐する中央ディスパッチャ」のような仕組みを作らない。画面を見れば、その画面で何が起きるかが分かる状態を保つ。
- **置き場所と役割を一致させる**。UI操作のオーケストレーション（`goto` や画面アクション）を `models/` 配下に置かない。`models/` はドメインデータ・永続化のロジックに限る。UIに属するものは feature/コンポーネントの近くに置く（探せること）。
- **画面ごとに将来分岐しうるUIは、共通コンポーネント化せず各画面に素直に書く**。重複を許容してでも、各画面が独立して調整できる状態を優先する。共通化してよいのは「画面に依存しない、真に共通な処理」をヘルパー関数（`utils/`・ストアのメソッド等）にまとめる場合に限る。条件分岐で複数画面を1つの部品に詰め込まない。
- 判断基準: 「この共通物を変えると、意図しない他画面に影響するか？」が Yes なら、それは過度な共通化。分割する。

---
_Document patterns, not file trees. New files following patterns shouldn't require updates_
