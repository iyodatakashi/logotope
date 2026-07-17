# Research & Design Decisions — public-index-page

## Summary
- **Feature**: `public-index-page`
- **Discovery Scope**: Extension（既存の公開トップを刷新。新規 SSR/load パターンを1つ導入）
- **Key Findings**:
  - 現公開トップの `topicsStore` は `topics` を無条件購読するため、`published == true` のみ許可する firestore.rules 下で**未認証クエリが拒否される**。`where('published','==',true)` に絞ることで匿名でもルール適合する。
  - 公開表示部品 `TopicListItem` は `TopicStates`（管理用の生きたオブジェクト）に型依存する「異物」。公開は `PublishedTopic` 前提で作り直し、管理系（`topicsStore`/`createTopicStates`/`*ForFirestore`）から型・データ経路ごと分離する（steering に横断ルール追記済み）。
  - `$lib/firebase.ts` は `getApps()` ガード＋ Vite インライン env で構成され、Firestore `db` は Node/SSR の `load` からも利用可能。SvelteKit universal `load`（`+page.ts`）で SSR 配信でき、steering の「公開ページは SSR で SEO 確保」に沿える。

## Research Log

### 未認証アクセスと firestore.rules の整合
- **Context**: Req 2（未認証で公開一覧を閲覧）。現状の公開トップが匿名で動くか。
- **Sources Consulted**: `firestore.rules`（`topics` read = `auth != null || resource.data.published == true`）、`src/lib/stores/topics.svelte.ts`（`query(collection('topics'), orderBy('createdAt'))`・`onSnapshot`）。
- **Findings**:
  - Firestore はクエリ結果全件が読み取り可能と**証明できる場合のみ**クエリを許可する。無条件クエリは非公開ドキュメントを含みうるため匿名で拒否される。
  - `where('published','==',true)` はルールの条件式と一致するため、匿名でも許可される。
- **Implications**: 公開取得は必ず `published == true` で絞る。ソートは JS 側で `publishedAt` 降順に行い、複合インデックスを不要にする（`firestore.indexes.json` は空のまま）。

### SSR/SEO と firebase client SDK の適合
- **Context**: steering(tech.md)「公開ページは `+page.server.ts` で SSR 配信し SEO 確保」。現トップは CSR（`onMount`+`onSnapshot`）。
- **Sources Consulted**: `src/lib/firebase.ts`（`getApps().length` ガード・`VITE_*` env・emulator 接続は `typeof window` ガード）、`svelte.config.js`（`adapter-auto`）、既存 `load` 不在（`admin/+layout.ts` の `ssr=false` のみ）。
- **Findings**:
  - Firestore modular SDK の `getDocs` は Node で動作。`db` は SSR から利用可能。
  - universal `load`（`+page.ts`）は SSR 初回描画時にサーバで実行され、データ込みの HTML を返せる。戻り値の `Date` は SvelteKit の devalue で直列化可能。
  - 本コードベースに `load` 実績はなく、firebase client SDK を SSR で使う初事例になる（要検証点）。
- **Implications**: `+page.ts` universal load で `published` 限定クエリ→`PublishedTopic` 射影→SSR 配信。firebase の SSR 動作に問題が出た場合は `export const ssr = false` に切替（匿名アクセスは限定クエリで担保されるため要件は満たせる）フォールバックを用意。

### 公開型の分離
- **Context**: 公開の読み取り経路が管理型に依存する歪みの排除（ユーザ決定）。
- **Findings**: `TopicListItem` は `id/title/personaCount/published/publishedAt` の5フィールドしか使わないのに `TopicStates` 型。利用箇所は公開トップ1箇所のみ。
- **Implications**: `PublishedTopic = { id, title, publishedAt }` を新設し、公開専用の一覧項目を作成。旧 `TopicListItem`（＋spec）は本仕様で撤去（管理側は不使用）。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | 採否 |
|--------|-------------|-----------|---------------------|------|
| A 既存拡張(CSR最小改修) | `topicsStore`/`+page.svelte` に `where published` 等を足す | 変更最小 | 管理型に依存継続・SSR方針と乖離・異物残存 | 不採用 |
| B 公開専用に新設(SSR/load) | `PublishedTopic`＋公開専用 load/描画を新設し管理系と分離 | 型・経路の完全分離・SEO適合・最小データ | 初のSSR firebase load（要検証） | **採用** |
| C ハイブリッド | 表示は流用・取得だけ分離 | 実装量中間 | `TopicStates` 依存を引きずる歪み | 不採用（ユーザ決定） |

## Design Decisions

### Decision: 公開取得は `published` 限定クエリ＋JS ソート（複合インデックス回避）
- **Context**: Req 1（公開日時降順）・Req 2（匿名適合）。
- **Alternatives Considered**:
  1. `where('published','==',true).orderBy('publishedAt','desc')` — サーバ順序だが複合インデックスが必要。
  2. `where('published','==',true)` のみ取得し、`publishedAt` 降順で JS ソート。
- **Selected Approach**: 2。件数が小さく（トピック単位）ページネーションも対象外のため、取得後に JS ソート。
- **Rationale**: 匿名ルール適合を満たしつつ、インデックス運用を増やさない。
- **Trade-offs**: 大量件数では非効率だが現規模では無視できる。将来ページネーション時は 1 に移行し複合インデックスを追加。
- **Follow-up**: 匿名での限定クエリ通過を実機/エミュレータで確認。

### Decision: SSR は universal `load`（`+page.ts`）で確定、realtime は廃止
- **Context**: steering の SSR/SEO 方針、公開一覧に realtime は不要。ユーザ決定＝SSR-now。
- **Selected Approach**: `+page.ts` の universal load（`ssr` 既定 true）で1回取得。`onSnapshot` は使わない。
- **Rationale**: SEO 済み HTML を返せる／公開一覧は更新頻度が低く一回取得で十分。
- **Trade-offs**: 公開直後の反映は次回ロード時。許容範囲。
- **Follow-up**: 実装は firebase client SDK の SSR 実行検証から着手（実装先頭タスク）。`ssr=false` は Req 4.1 の SEO 目的を損なうため安易に採らない（採る場合はメタを `+layout` へ退避する設計変更を伴う）。

### Decision: 公開 SSR は Firestore 専用の `firebase-public` を分離して使う
- **Context**: `src/lib/firebase.ts` はモジュール読み込み時に `getAuth`/`getFunctions` も初期化する。universal `load` の SSR 実行でこれを import すると、公開読み取りに不要な Auth 初期化を巻き込み SSR が不安定化しうる（design レビュー指摘）。
- **Alternatives Considered**:
  1. 既存 `$lib/firebase` の `db` をそのまま使う — Auth 初期化を巻き込む。
  2. `firebase-public.ts`（Firestore のみ初期化・`publicDb` を export）を新設し、config は副作用のない `firebase-config.ts` に切り出して共有。
- **Selected Approach**: 2。公開 SSR 経路は `firebase-public` の `publicDb` のみに依存。`firebase.ts` は config を `firebase-config.ts` から import する変更のみ（Auth/Functions 込みの役割は据え置き）。
- **Rationale**: SSR 依存面を Firestore に限定し、検証ゲートが本質（Firestore 読み取り）だけを見られる。`getApps()` ガードで app は単一共有、config 二重管理も回避。
- **Trade-offs**: ファイル2つ増（薄い初期化とリテラルのみ）。抽象化ではなくリテラル移動のため過度な共通化には当たらない。
- **Follow-up**: 公開経路が `$lib/firebase` を import していないことを実装で担保。

### Decision: `PublishedTopic` は最小射影 `{ id, title, publishedAt }`
- **Context**: 公開型の分離（`Published` 接頭辞）と最小主義。
- **Selected Approach**: `personaCount`・`published` は載せない（前者は不要、後者はクエリが保証）。
- **Rationale**: インデックスの目的（記事選択）に必要な情報のみ。
- **Trade-offs**: 一覧から「N名参加」表示が消える（意図的）。

## Risks & Mitigations
- **SSR で firebase client SDK が想定外の挙動をする** — `+page.ts` の load をエミュレータ/本番相当で**実装先頭に検証**する（通ってから UI へ）。SSR 不可判明時のみ設計見直し（`ssr=false` は SEO 目的を損なうため、採る場合はメタを `+layout` へ退避する変更を伴う）。
- **匿名クエリがルールで弾かれる** — `where('published','==',true)` がルール条件と一致することを確認。エミュレータの rules テストで担保。
- **旧 `TopicListItem` 撤去の巻き込み** — 利用は公開トップ1箇所のみと確認済み。撤去は本仕様内で完結。

## References
- SvelteKit `load`（universal vs server）: https://svelte.dev/docs/kit/load — SSR/CSR 両実行と直列化の前提。
- Firestore security rules とクエリの整合（queries must be provably safe）: https://firebase.google.com/docs/firestore/security/rules-query — 限定クエリの必要性の根拠。
