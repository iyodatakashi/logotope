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
├── api/                        # HTTPエンドポイント（onRequest）
│   ├── topics.ts
│   ├── stakeholders.ts
│   ├── personas.ts
│   ├── interviews.ts
│   └── debates.ts
├── pipeline/                   # AI生成パイプライン
│   ├── stakeholder-analyzer.ts
│   ├── persona-generator.ts
│   ├── interviewer.ts
│   └── debate-orchestrator.ts
├── agents/                     # マルチエージェント構造
│   ├── facilitator-agent.ts
│   └── persona-agent.ts
└── types/
    └── index.ts                # Functions共通型定義
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

---
_Document patterns, not file trees. New files following patterns shouldn't require updates_
