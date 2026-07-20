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
- **Firestore 永続型**: `*ForFirestore` サフィックスを付ける（例: `PersonaForFirestore` / `TopicForFirestore`）。`*Doc` は使わない。狙いは「Firestore 永続形である」用途を型名で明示すること（`Doc` は用途が曖昧なので禁止）。`Timestamp`→`Date` 変換や doc id を materialize したインメモリのドメイン型は、素の名前にする（例: `Persona` / `Topic`）。両者が完全一致（id 差・日付差が無い）なら型を分けず素の名前1つにする。
- **公開（閲覧）用の型**: `Published` 接頭辞を付ける（→「公開（閲覧）用の型は `Published` 接頭辞を付ける」節を参照）。

## 型定義の規約（重要）

型はプロジェクト全体で置き場所・命名・境界を統一する。**型やコードを書く前に、まずこの規約を照合する。**

- **置き場所**: フロント（`src/lib`）の型は `src/lib/models/<domain>/<domain>.types.ts` に書く。`src/lib/types/` のような汎用の場所に新しい型を置かない。Functions 側（`functions/src`）は `functions/src/types/` に書いてよい。
- **`.types.ts` に集約**: 型定義は必ず `.types.ts` に集約する。取得/射影関数などの `.ts` にローカル型をインライン定義しない。**共用できる型は共用**し（Admin と共通なら既存型を参照）、重複定義しない。共用できず新規定義する場合のみ、用途が分かる名前・場所に置く（公開専用なら published の `.types.ts` に `Published*`）。
- **`.types.ts` は型と型ガードのみ**: 変換関数（Firestore 型→アプリ型など）を `.types.ts` に置かない。変換は利用側（ストア・取得関数）にインラインで書く。
- **Firestore 永続型 = `*ForFirestore`**（`*Doc` 禁止。→ Naming Conventions）。インメモリのドメイン型は素の名前。両者が完全一致（id 差・日付差が無い）なら型を分けず単一の素の名前にする（例: `Narration`）。
- **`*ForFirestore` はフロントで引き回さない**: `*ForFirestore` は Firestore 境界（`doc.data() as XxxForFirestore` の cast）でだけ触り、その場でフロント用ドメイン型／`Published*` へ射影する。フロントの state や引数に `*ForFirestore` を保持しない。
- **ランタイム型は永続型と一致させる**: Partial 転送形や、永続されないフィールド拡張を作らない。拡張するなら永続の書き出し・読み戻しの両方に同じフィールドを通す。
- **型を移動したら import を直す**: 旧ファイルに `export type { X }` の re-export を残さない。利用側の import パスを新しい場所へ直接書き換える。

## 公開（閲覧）用の型は `Published` 接頭辞を付ける（重要）

公開（閲覧者向け）**専用に型を定義するときは、必ず `Published` 接頭辞を付ける**（例: `PublishedTopic` / `PublishedArticle` / `PublishedChapter`）。狙いは「**その型が何専用かを名前で明示する**」こと。接頭辞によって「これは公開の読み取りモデル（読み取り専用・表示に必要な最小射影）」だと型名から一目で分かる。場当たり的な名前（`PersonaDoc` / `TurnDoc` のように、公開読み取り用なのか永続型なのか判別できない命名）を付けて用途を曖昧にしない。これは**命名規約**であって、Admin と機械的に分離せよという意味ではない。

- **公開専用の型には `Published` 接頭辞を付ける**。読み取り専用の最小射影とし、表示に必要なフィールドだけを持たせる。公開部品・データ取得の**出力型**はこの `Published*` を使う。
- **共用できる型は共用する**。Admin と本当に共通な型を、公開専用として重複定義しない。特に Firestore の読み取り入力は、境界で `doc.data() as XxxForFirestore` として Admin の永続型（`*ForFirestore`）を cast 参照し、その場で `Published*` へ射影する（`*ForFirestore` を保持・引き回さない点は [[feedback-no-forfirestore-in-frontend]] と同じ）。「公開だから Admin 型に一切触れるな」という機械的分離はしない。
- **避けたいのは、管理機能の巨大なミューテーション面を公開の読み取り経路へ引き込むこと**（`createTopicStates` が返す `TopicStates`・admin ストア等）。これは結合・歪みの原因になるので公開側に持ち込まない。分離が意味を持つのはこの一点で、原則を目的から逆算して適用する。
- 公開部品を作る際、既存の管理用コンポーネントを「見た目が同じだから」と丸ごと流用しない。見た目の踏襲は可。

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
- 型定義はフロントエンド用（`src/lib/models/<domain>/<domain>.types.ts`）とFunctions用（`functions/src/types/`）を分離する（→「型定義の規約」）。重複を避けるため、共通型はFunctions側で定義してAPIレスポンスとして渡す

## 過度な共通化・抽象化をしない（重要）

UIの一貫性は「同じ仕様であること」で担保する。**共通の部品やディスパッチャに各画面の分岐を吸わせて担保しようとしない**。後から1画面だけ調整したいときに、全画面に影響する共通物を触ることになり、非合理的。

- **画面の操作（アクション・遷移）は、その画面のコンポーネントに直接書く**。「フェーズ番号で分岐する中央ディスパッチャ」のような仕組みを作らない。画面を見れば、その画面で何が起きるかが分かる状態を保つ。
- **置き場所と役割を一致させる**。UI操作のオーケストレーション（`goto` や画面アクション）を `models/` 配下に置かない。`models/` はドメインデータ・永続化のロジックに限る。UIに属するものは feature/コンポーネントの近くに置く（探せること）。
- **画面ごとに将来分岐しうるUIは、共通コンポーネント化せず各画面に素直に書く**。重複を許容してでも、各画面が独立して調整できる状態を優先する。共通化してよいのは「画面に依存しない、真に共通な処理」をヘルパー関数（`utils/`・ストアのメソッド等）にまとめる場合に限る。条件分岐で複数画面を1つの部品に詰め込まない。
- 判断基準: 「この共通物を変えると、意図しない他画面に影響するか？」が Yes なら、それは過度な共通化。分割する。

---
_Document patterns, not file trees. New files following patterns shouldn't require updates_
