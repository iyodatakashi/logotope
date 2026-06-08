# Technology Stack

## Architecture

Firebase App Hosting 上の SvelteKit（SSR）＋ Firebase Functions v2（AI パイプライン専用）＋ Firebase Data Connect（PostgreSQL）の3層構成。

- **公開ページ**（`/`・`/debate/[id]`）: SvelteKit SSR で配信し SEO に対応
- **管理画面**（`/admin/**`）: Firebase Auth 保護のクライアントサイド SPA
- **短時間 CRUD API**: SvelteKit `+server.ts` に実装（Functions を経由しない）
- **長時間 AI 処理**: Firebase Functions v2 に委譲（最大60分タイムアウト）

```
[Browser]
    ↓ page request
[Firebase App Hosting — SvelteKit adapter-auto]
    ↓ server-side data fetch (SSR)      ↓ AI pipeline call (admin)
[Data Connect (PostgreSQL)]    [Firebase Functions v2 (AI Pipeline)]
                                         ↓
                                 [Claude API (Anthropic)]
                                         ↓
                                 [Data Connect] + [Firestore (progress)]
```

## Core Technologies

- **Language**: TypeScript（フロントエンド・Functions 共通、strict mode）
- **Framework**: SvelteKit 2.x（`@sveltejs/adapter-auto` で Firebase App Hosting にデプロイ）
- **Runtime**: Node.js 24（Firebase Functions v2）
- **Package Manager**: pnpm（ワークスペース構成）

## Key Libraries

### フロントエンド
- **UI Components**: `@14ch/svelte-ui` — プロジェクト標準UIコンポーネントライブラリ（Svelte 5対応、TypeScript、SCSS）。カスタムコンポーネントを書く前に必ずこのライブラリのコンポーネントを優先して使用する
- **Svelte**: 5.x（runes API使用）

### バックエンド（Firebase Functions）
- **firebase-admin**: ^13.x
- **firebase-functions**: ^7.x（v2 API使用）
- **AI**: Anthropic SDK（Claude API）

### データ
- **Firebase Data Connect**: GraphQL スキーマ → PostgreSQL（リレーショナルデータ、永続化）
- **Firestore**: リアルタイム状態管理（AI生成の進捗トラッキング）
- **Firebase Auth**: メール/パスワード認証（管理者のみ）

## Development Standards

### Type Safety
- TypeScript strict mode を必須とする
- `any` 型の使用禁止。判明しない型は `unknown` を使用しナローイングする
- Svelte コンポーネントのpropsは明示的に型定義する

### Code Quality
- ESLint + Prettier（プロジェクト設定に従う）
- コンポーネントファイル: `.svelte`（Svelte 5 runes構文）
- サーバーサイドロジック: `.ts`（Functions内）

### Testing
- Unit: Vitest
- E2E: Playwright
- AI生成ロジックはモックを使ってUnit Testを書く

## Development Environment

### Required Tools
- Node.js 24+
- pnpm
- Firebase CLI
- Firebase Emulators（DataConnect、Functions、Firestore）

### Common Commands
```bash
# Dev (frontend): pnpm dev
# Dev (emulators): firebase emulators:start
# Build: pnpm build
# Test (unit): pnpm test:unit
# Test (e2e): pnpm test:e2e
# Functions build: npm --prefix functions run build
```

## Key Technical Decisions

- **SSRホスティング**: SvelteKit は `adapter-auto` で Firebase App Hosting にデプロイ。公開ページは `+page.server.ts` でSSR配信しSEOを確保する。管理画面はクライアントサイドSPAとして動作する
- **API層の分担**: 短時間の読み取り操作は SvelteKit `+server.ts` に実装。長時間AI処理（討論生成・取材など）のみ Firebase Functions v2（最大60分）に委譲する
- **AI処理の非同期化**: 討論生成などの長時間処理はFirebase Functions v2で非同期実行し、Firestoreで進捗を管理する
- **UI**: `@14ch/svelte-ui` を標準コンポーネントとして使用し、プロジェクト独自の追加コンポーネントは `src/lib/components/` に配置する

---
_Document standards and patterns, not every dependency_
