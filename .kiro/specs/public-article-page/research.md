# Research & Design Decisions — public-article-page

## Summary
- **Feature**: `public-article-page`
- **Discovery Scope**: Extension（`public-index-page` が敷いた公開読み取り基盤の上に、単一記事ページを増設する）
- **Key Findings**:
  - 公開読み取り基盤（`firebase-public` の `publicDb`・`firebase-config`・universal `load`・`Published*` 型分離）は `public-index-page` で確立済み。本仕様はこの経路を単一記事へ拡張するだけで、新規インフラは不要。
  - 記事本文の情報源は既存の編集成果物（`editedChapters` / `editorial/0`）と原本（`chapters` / `personas`）。firestore.rules は `published == true` の topic 配下でこれらの一般読み取りを既に許可しており、rules 変更は不要。
  - firestore.rules の性質上、未公開・不在の topic 読み取りは `permission-denied` として返り、真の不在／権限拒否と区別できない。これを「記事なし（404）」へ写像する必要がある（下記 Decision 参照）。
  - awareness はペルソナ文書に埋め込まれ `triggeredByTurnId` で原本ターンに紐づく。編集後ターンは `sourceTurnIds`（複数可）で原本ターンを参照するため、公開表示でも `sourceTurnIds` 経由の join が必要（既存 `EditingChapter` と同じ引き当て）。

## Research Log

### 公開読み取り基盤の再利用可否（firebase-public / Published 型）
- **Context**: 単一記事の公開ページを、Admin 型・ストアに依存せず SSR で配信する必要がある。
- **Sources Consulted**: `src/lib/firebase-public.ts`, `src/lib/firebase-config.ts`, `src/lib/models/published/published-topics.ts`, `src/routes/+page.ts`, `.kiro/specs/public-index-page/design.md`, `.kiro/steering/structure.md`（公開型分離）, `tech.md`（公開ページは SSR）。
- **Findings**:
  - `publicDb` は Firestore 専用初期化（Auth/Functions 不初期化）で SSR 安全。未認証読み取りに使える。
  - `fetchPublishedTopics` は `where('published','==',true)` の限定クエリで rules 適合。射影（`topics` doc → `PublishedTopic`）は取得関数にインラインで実装（`*.types.ts` は型と型ガードのみ）。
  - universal `load`（`+page.ts`）＋ `navigating` によるローディング表示が公開ページの既定パターン。
- **Implications**: 本仕様は `publicDb` を使う単一記事取得関数 `fetchPublishedArticle(topicId)` と `PublishedArticle` 系型を新設し、`/articles/[topicId]/+page.ts` の `load` で射影済みデータを渡す。Admin 型・ストアには一切依存しない。

### 記事本文の情報源と章フォールバック
- **Context**: 記事は「導入・章立ての議論・締め・所感」で構成され、本文は編集成果物を優先しつつ未編集章は原本にフォールバックする。
- **Sources Consulted**: `src/lib/stores/editedChapters.svelte.ts`, `src/lib/stores/chapters.svelte.ts`, `src/lib/stores/editorial.svelte.ts`, `src/lib/features/admin/topic-detail/editing/EditingChapter.svelte`, `EditingNarration.svelte`, `EditingImpression.svelte`, `chapter.types.ts`, `editorial.types.ts`, `turn.types.ts`。
- **Findings**:
  - 章表示状態は `completed` / `failed` / `missing`。Admin は `completed` のみ編集後ターンを表示し、`failed`／`missing` は原本にフォールバックする。
  - `editedChapters` と `chapters` は `chapterIndex` で対応づく（doc id は一致とは限らないため index でペアリングする）。
  - 記事要素（intro/outro/impressions）は統合 `editorial/0`。各要素は `final`（編集後）と `draft`（原本）を持ち、表示は `final ?? draft`、両方 null は「内容なし」で非表示。
  - impressions は `personaId` キーのマップ＋ `sortOrder`。話者名は描画時に `personaId` から解決する。
- **Implications**: `fetchPublishedArticle` が章のペアリング・フォールバック・editorial の `final ?? draft` 射影・impressions のソートを読み込み境界で行い、`PublishedArticle` に materialize する。

### awareness の帰属と join
- **Context**: awareness を本文に直接展開せず、発話ごとのアフォーダンス（アイコン＋件数）→ダイアログで見せる。
- **Sources Consulted**: `src/lib/stores/personas.svelte.ts`（`awarenessesByTurn` / `getAwarenessesByTurn`）, `persona.types.ts`（`AwarenessForFirestore.triggeredByTurnId`）, `EditingChapter.svelte`（`awarenessesOf` が `sourceTurnIds` を flatMap）。
- **Findings**:
  - awareness は各ペルソナ文書の `awarenesses[]` に埋め込まれ、`triggeredByTurnId`（原本ターン id）で発話に紐づく。
  - 編集後ターンは `sourceTurnIds`（>=1）で原本を参照。1発話が複数原本ターンの連結でありうるため、awareness は `sourceTurnIds` 全てから集める。原本フォールバック時は当該原本ターン自身の id で引く。
  - 表示に必要なのは「誰の気づきか（personaName）」と「内容（content）」。
- **Implications**: 射影時に発話へ `PublishedAwareness[]` を焼き込む（personaName は境界で解決）。件数 0 の発話にはアフォーダンスを出さない。

### スクロール追従による目次の現在地強調
- **Context**: 左ペイン固定の目次で、本文スクロールに応じて現在の章を強調（`<strong>` 不使用・CSS セレクタで表現）。
- **Sources Consulted**: コードベース内 `IntersectionObserver` 使用実績（grep：なし）。`@14ch/svelte-ui` エクスポート（`Dialog` / `Modal` / `Icon` / `IconButton` 等あり）。
- **Findings**:
  - スクロールスパイの実績は無い。`IntersectionObserver` で章セクションの可視状態を監視し現在章を決めるのが標準的で軽量。SSR では監視を張らず（`onMount`/ブラウザガード）、初期はハイライト無し（または先頭章）で描画する。
  - 強調は状態クラス（例 `.article-toc__item--active`）＋スタイルで表現でき、DOM 要素差し替え（`<strong>`）は不要。
- **Implications**: 目次コンポーネントにブラウザ限定のオブザーバを持たせ、`activeChapterId` を状態化。TOC 項目は `class:...--active` を付与。要素差し替えはしない。

### 気づきダイアログの UI 部品
- **Context**: 標準 UI（`@14ch/svelte-ui`）優先の方針。
- **Sources Consulted**: `@14ch/svelte-ui` の `dist/index.js` エクスポート一覧。
- **Findings**: `Dialog` / `Modal` / `Icon` / `IconButton` / `Button` / `Skeleton` を提供。ダイアログは `Dialog`、アフォーダンスは `IconButton`＋件数で構成できる。
- **Implications**: awareness アフォーダンス＋ダイアログは標準部品で実装し、独自モーダルは作らない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: `public-index-page` の公開経路を単一記事へ拡張（採用） | `publicDb` + universal `load` + `Published*` 型で記事取得・射影・表示を公開ドメインに閉じる | 既存基盤に整合／Admin 型と完全分離／SSR で SEO 確保 | 複数コレクション join を境界で担う実装量 | steering「公開型分離」「SSR」「過度な共通化をしない」に合致 |
| B: 既存 admin ストア（`editedChaptersStore` 等）を公開で再利用 | 既存ストアをそのまま購読 | 実装が薄い | `$lib/firebase`（Auth/Functions）依存・Admin 型混入で steering 違反／未認証で機能しない | 却下 |
| C: Functions に公開記事取得 API を新設 | onCall/HTTP で整形済み記事を返す | クライアント join 不要 | 短時間読み取りは Functions 不要（tech.md）／SSR で直接 Firestore を読める | 却下（オーバーエンジニアリング） |

## Design Decisions

### Decision: 未公開・不在を 404 として扱い、`permission-denied` を not-found に写像する
- **Context**: firestore.rules は未認証読み取りを `published == true` に限定する。未公開・不在の topic 読み取りは `permission-denied` を返し、真の権限拒否や不在と区別できない。
- **Alternatives Considered**:
  1. 200 + 画面内「記事が見つかりません」表示（sibling の空表示に倣う）— SEO 的に不正確（存在しない記事が 200）。
  2. `load` で `error(404)` を投げ、`+error.svelte` で提示（採用）。
- **Selected Approach**: `fetchPublishedArticle` は「不在・未公開・`permission-denied`」を `null` で返し、それ以外の失敗は throw。`+page.ts` は `null → error(404)`、throw → `error(500)`。`+error.svelte` が 404／500 を出し分け、インデックスへの導線を出す。
- **Rationale**: HTTP ステータスが正しくなり（SEO/クローラ適合）、Req 5.2/5.3/8.2（不在時に記事前提のメタを出さない）を素直に満たす。
- **Trade-offs**: sibling（一覧）は状態フラグ方式だが、記事は URL 直アクセス・被リンク対象のためステータスコード整合を優先。実装がやや増える。
- **Follow-up**: `permission-denied` 判定は Firestore エラーの `code` で行う。他コード（`unavailable` 等）は 500 に写像。

### Decision: 章は `chapterIndex` でペアリングし `completed` のみ編集後を採用
- **Context**: `editedChapters` と `chapters` の対応づけと、未編集章のフォールバック。
- **Selected Approach**: `chapterIndex` でペアリング。編集後章が `status === 'completed'` のときのみ編集後ターンを採用、それ以外（`failed`／未生成）は原本 `chapters` のターンを採用。章アンカー/目次キーは安定な `chapterIndex` を用いる（可変配列 index を外部キーにしない方針に合致）。
- **Rationale**: Admin の既存表示規則と一致。`chapterIndex` は安定な同一性キー。
- **Trade-offs**: 章タイトルは編集後・原本いずれかから取得（`completed` は編集後、それ以外は原本）。

### Decision: 記事本文の射影は「読み物のみ」に限定
- **Context**: Req 2.6 は診断注釈（ファクトチェック・信念変化・エンゲージメント等）の非表示を要求。
- **Selected Approach**: `PublishedSpeech` は `speakerName` / `speakerRole` / `content` / `awarenesses` のみを持つ。`factCheck`・`engagementScore`・`speechMode` 等は射影に含めない。awareness のみ Req 3 のダイアログ経由で提示。
- **Rationale**: 型レベルで診断情報の漏れを防ぎ、読み物としての一貫性を保つ。

## Risks & Mitigations
- **複数コレクション join の取りこぼし（awareness/フォールバック）** — 射影ロジックをユニットテストで固定（`completed`/`failed`/`missing`・`sourceTurnIds` 複数・awareness 0 件）。
- **`permission-denied` の誤写像（真の障害を 404 にしてしまう）** — `code` を厳密判定し、`permission-denied` のみ null。他は throw→500。
- **スクロールスパイの SSR 実行** — `IntersectionObserver` はブラウザ限定で生成（`onMount`/`browser` ガード）。SSR は静的な目次を出す。
- **1MB ドキュメント／読み込み課金** — 記事取得は topic・editorial（1 doc）・editedChapters/chapters/personas の一回取得（`getDocs`）。realtime 購読はしない（公開記事は静的）。

## References
- `.kiro/specs/public-index-page/design.md` — 公開経路・`Published*` 型分離・SSR load の先行設計
- `.kiro/steering/structure.md` — 公開型と管理型の分離（`Published` 接頭辞）／過度な共通化の禁止
- `.kiro/steering/tech.md` — 公開ページは SSR で SEO 確保
- `.kiro/steering/firebase.md` — published 限定の公開読み取り rules／課金モデル／onSnapshot vs getDocs
