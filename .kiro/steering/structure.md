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
