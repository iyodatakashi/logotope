# Gap Analysis — public-index-page

## 分析サマリ

- **公開型は Admin から完全分離する（決定事項）**: 公開側のアプリ層型は `Published` 接頭辞で統一し、`Topic` / `TopicStates` / `*ForFirestore` に依存しない。本仕様の読み取りモデルは `PublishedTopic = { id, title, publishedAt }`。
- **既存 `TopicListItem` は「異物」として直接流用しない**: prop 型が `TopicStates`（＝`createTopicStates` の管理操作を全部持つ生きたオブジェクト）で、実使用は5フィールドのみ。公開の読み取り経路がこの管理面に型依存するのは歪み。公開は `PublishedTopic` 前提で作り直す（見た目は踏襲してよい）。
- **未認証アクセスが現状壊れている（最重要）**: 公開トップの `topicsStore` は `topics` を無条件（`where` なし）で購読するため、`published == true` のみ許可する firestore.rules 下では**匿名クエリが拒否される**。Req 2 を満たすには「`published == true` に絞ったクエリ」が必須。
- **SEO/SSR の乖離**: steering(tech.md)は「公開ページは SSR で SEO 確保」を掲げるが、現トップは CSR（`onMount` + `onSnapshot`）で、メタ情報に本文が乗らず初回描画も空。Req 4 とプロダクトの公開意図に照らして要判断。
- **リンク先の変更**: 一覧項目の遷移先を `/debate/{id}` から `/articles/[topicId]` に改める（記事ページ自体は別仕様）。
- 推奨は **Option B 寄り（公開専用に新設）**: `PublishedTopic` と公開専用の取得（`published` 限定）・描画を最小構成で新設し、管理系（`topicsStore` / `createTopicStates`）から分離する。既存の見た目は踏襲するが型・データ経路は共有しない。

## Requirement-to-Asset Map

| Req | 内容 | 既存資産 | ギャップ（分類） |
|-----|------|----------|------------------|
| 1 | 公開済み記事の一覧・公開日時降順・項目表示・遷移導線 | `src/routes/+page.svelte`（`publishedAt` 降順ソート済）、`TopicListItem.svelte`（見た目の参考） | **Constraint**: `TopicListItem` は `TopicStates` 依存の異物で直接流用しない。`topicsStore` は管理用の全件購読で使わない。**Missing**: 公開読み取りモデル `PublishedTopic` と公開専用の一覧描画、リンク先 `/debate/{id}` → `/articles/[topicId]` |
| 2 | 未認証で閲覧、公開データのみ要求、admin 導線なし | `firestore.rules`（`published == true` で一般読み取り許可）、`authStore` | **Missing/Constraint（最重要）**: 無条件クエリは匿名で拒否される。`where('published','==',true)` が必要だが `where()` 使用実績ゼロ、複合インデックス未定義（`firestore.indexes.json` は空） |
| 3 | 読み込み中 / 0件 / 取得失敗の表示 | 現トップに loading・empty 表示あり | **Missing**: 取得失敗表示。`onSnapshot` の error パスが未処理 |
| 4 | タイトル・説明・OGP 等メタ情報、説明文は据えない | 現トップの `<svelte:head>`（title/description/og:title/og:description） | **Constraint**: CSR のためクローラに一覧本文が乗らない（SSR 方針と乖離）。**Missing**: `og:url`・OGP 画像等の整備、SSR 化の要否判断 |
| 5 | レスポンシブ表示 | 現トップ（`max-width:720px`・flex 縦積み） | **Low**: 概ね対応済。実機確認のみ |

## 技術的必要事項（EARS からの抽出）

- データ取得: `published == true` に絞った Firestore クエリ（匿名で rules を通る形）。公開日時（`publishedAt`）降順ソート。
- 配信: SEO 用のメタ情報。SSR で本文を含めるか、CSR のまま `<svelte:head>` に静的メタのみ載せるかの判断。
- ルーティング: 記事ページへのリンク（`/articles/[topicId]`）。記事ページ本体は本仕様外。
- 非機能: 未認証アクセス（セキュリティ／ルール適合）、初回描画品質（SEO・体感）、レスポンシブ。

## 実装アプローチ

### Option A: 既存トップの最小改修（CSR 維持）
`+page.svelte` と `topicsStore` を最小限だけ直す。
- `topicsStore`（または公開用の派生クエリ）に `where('published','==',true)` を追加、リンク先を `/articles/[topicId]` に変更、取得失敗表示を追加。
- ✅ 変更が小さく速い / 既存 `onSnapshot` 構成を踏襲
- ❌ SSR/SEO 方針（tech.md）と乖離したまま / `topicsStore` は管理用途と混在（公開に不要な全件・createTopicStates を引きずる） / 複合インデックスは依然必要

### Option B: 公開専用に新規構築（採用）
公開読み取りモデル `PublishedTopic = { id, title, publishedAt }` と、公開専用の取得（`published == true` 限定＋公開日時降順）・一覧描画を新設し、管理系（`topicsStore` / `createTopicStates` / `TopicStates`）から**完全に分離**する。
- 取得: `published` 限定クエリ（SSR/load か client SDK の限定クエリかは design で判断）。射影は境界で `topics` ドキュメント → `PublishedTopic`。
- 表示: 公開専用の一覧項目を新設（既存 `TopicListItem` の見た目は参考にしてよいが、`TopicStates` 依存を持ち込まない）。状態表示（loading/empty/失敗）は `+page.svelte` に直接記述（steering: 画面の処理は画面に書く）。リンク先は `/articles/[topicId]`。
- ✅ 公開↔管理を型・データ経路ごと分断（異物の混入なし）/ SEO 方針に合致 / 公開に必要な最小データのみ取得
- ❌ SSR 時の Firestore アクセス方式の設計が必要（下記 Research）/ realtime を捨てる（公開一覧では許容できることが多い）

### Option C: ハイブリッド（不採用）
表示部品を流用しつつ取得だけ分離する中間案。`TopicListItem` の `TopicStates` 依存を引きずり、公開の読み取り経路に管理面が混入する歪みが残るため**不採用**（ユーザ決定）。

## Effort & Risk

- **Effort: M（3〜7日）** — クエリの `published` 限定化＋複合インデックス、リンク先変更、状態表示、（採用すれば）SSR/load 化。CSR 最小改修に留めれば **S** に縮む。
- **Risk: Medium** — 匿名アクセスの rules 適合・複合インデックス・SSR 時の Firestore アクセス方式が未検証。表示側は既存資産で低リスク。

## Research Needed（design フェーズへ持ち越し）

1. **SSR 時の Firestore アクセス方式**: `+page.server.ts` で Client SDK の `published==true` クエリを使うか、Functions 経由にするか。steering「フロントから Firebase Admin 直接アクセス禁止」との整合を確認。CSR 維持なら不要。
2. **複合インデックス**: `where('published','==',true).orderBy('publishedAt','desc')` に必要な複合インデックスを `firestore.indexes.json` に追加する要否・内容。
3. **匿名クエリのルール適合検証**: `where published==true` を付けたクエリが未認証で実際に通ること（現状の全件クエリが匿名で通らないことの確認を含む）。
4. **realtime の要否**: 公開一覧で `onSnapshot`（realtime）を維持するか、`load` の一回取得にするか。
5. **後方互換**: `published==true` だが `publishedAt` 未設定の公開データが理論上存在した場合のソート・日時表示の扱い（publish 操作は両方書くため通常発生しないが表示分岐で吸収）。

## design フェーズへの推奨

- **採用アプローチ: Option B（公開専用に新規構築）**。`PublishedTopic = { id, title, publishedAt }` と公開専用の取得・描画を新設し、管理系（`topicsStore` / `createTopicStates` / `TopicStates` / `*ForFirestore`）から型・データ経路ごと分離する。
- **公開型の分離規約**: 公開側アプリ層型は `Published` 接頭辞で統一（本仕様は `PublishedTopic`、後続は `PublishedArticle` / `PublishedChapter` …）。公開コンポーネント・取得は `Published*` のみに依存。射影は読み込み境界で行う。
- **鍵となる決定（design で確定）**: (a) SSR/SEO を今回どこまで満たすか（`+page.server.ts` 導入 vs CSR＋静的メタ）、(b) 公開取得を Client SDK 限定クエリにするか Functions 経由にするか、(c) realtime を残すか一回取得か、(d) `PublishedTopic` の置き場所（`src/lib/models/` 配下の公開ドメイン）。
- 記事ページ（`/articles/[topicId]`）本体は別仕様。本仕様は入口リンクの提供までに限定する。
