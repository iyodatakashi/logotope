# Testing Standards

## ディレクトリ構成

テストファイル・spec ファイルはソースと**同一ディレクトリに置かない**。
必ず専用の `tests/` ディレクトリに、ソース構造をミラーして配置する。

### フロントエンド（`src/`）

```
src/
├── lib/
│   ├── stores/chapters.svelte.ts
│   └── features/admin/debate/Phase5Debate.svelte
└── tests/                                         # テストはここに集約
    ├── stores/chapters.test.ts
    └── features/admin/debate/Phase5Debate.svelte.spec.ts
```

インポートは `$lib/` エイリアスを使う（相対パス禁止）：
```typescript
import { createChaptersStore } from '$lib/stores/chapters.svelte';
```

### バックエンド（`functions/src/`）

```
functions/src/
├── agents/chapter-agent.ts
├── pipeline/debate/turn.ts
└── tests/                                         # テストはここに集約
    ├── agents/chapter-agent.test.ts
    └── pipeline/debate/turn.test.ts
```

エイリアスがないため、`tests/{subdir}/` から `../../../{path}` 形式の相対パスになる。
`vi.mock()` の引数パスも同様に変換が必要。

## ファイル命名

- ユニットテスト（Vitest node）: `*.test.ts`
- コンポーネント spec（Vitest browser）: `*.svelte.spec.ts`
- インテグレーション: `*.integration.test.ts`

## テスト種別と対象

| 種別 | 対象 | モック方針 |
|------|------|-----------|
| ユニット | stores / models / utils | Firestore・firebase をモック |
| ブラウザ spec | Svelte コンポーネント | `currentTopicStore` 等をモック |
| インテグレーション | Firestore ルール等 | Firebase Emulator を使用 |

## モック方針

- Firestore（`$lib/firebase`・`firebase/firestore`）は必ずモックする
- テスト対象のモジュール自体はモックしない
- `vi.mock` はファイル先頭、`import` より前に書く
- `beforeEach` で `vi.clearAllMocks()` とコールバック変数をリセットする

## ストアのテスト構造

```typescript
// スナップショットコールバックを外部変数で捕捉
let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('firebase/firestore', () => ({
  onSnapshot: vi.fn((_ref, cb) => { snapshotCb = cb; return vi.fn(); }),
  // ...
}));

// populate ヘルパーで start + snapshot 投入をまとめる
const populate = (store, docs) => {
  store.start();
  snapshotCb?.({ docs: docs.map(d => ({ id: d.id, data: () => d })) });
};
```

## 禁止事項

- テストファイルをソースと同じディレクトリに置かない
- `any` 型を使わず `never` でキャストするか型を明示する
- テスト内で実際の Firestore に接続しない（インテグレーション以外）
