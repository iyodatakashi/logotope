# Requirements Document

## Introduction

閲覧者（一般ユーザー）が、公開済みの討論を1本の読み物として通読するための**公開記事ページ**（`/articles/[topicId]`）を作成する。本ページは、`public-index-page`（公開インデックス）の一覧項目からの遷移先であり、AIペルソナ同士の討論を「導入 → 各章の議論 → 各ペルソナの所感 → 締め」という記事構成で提示することを目的とする。

記事の本文は、討論の生データ（原本ターン）ではなく、編集フェーズで整えられた読み物成果物（`editedChapters` と `editorial/0`）を主たる情報源とする。閲覧者は認証なしにアクセスでき、SEO・共有に耐えるよう SSR で配信する。

本ページは討論に結論を求めず、複数の立場が筋道立てて成立しうる様子をそのまま読ませる（対立・勝敗の煽りをしない）プロダクト方針に従う。

## Boundary Context

- **In scope**:
  - 公開記事ページ（ルート `/articles/[topicId]` ＝ 新設 `src/routes/articles/[topicId]/+page.svelte`）の作成
  - 公開済み討論を記事構成（導入・章立ての議論・締め・各ペルソナの所感）で通読表示する
  - 気づき（awareness）を本文に直接載せず、発話ごとのアフォーダンス（アイコン＋件数）からダイアログで表示する
  - 左ペインに固定した目次と、本文スクロールに追従する現在地（現在の章）の強調表示
  - 未認証の閲覧者を前提とした表示とデータ取得（SSR 配信）
  - 記事単位の共有／検索向けメタ情報、取得状態（読み込み中・未公開/不在・取得失敗）の表示、レスポンシブ表示、インデックスへの導線
- **Out of scope**:
  - 公開インデックスページ（`/` ＝ `public-index-page` 仕様）の変更
  - 記事本文となる編集成果物（`editedChapters` / `editorial`）そのものの生成・編集ロジック（別途 admin/pipeline 側で実装済み）
  - コメント投稿・リアクション・共有ボタン等の双方向機能、章内検索・目次以外のナビゲーション拡張
  - 管理（admin）側の画面、公開 ON/OFF 操作（`publish-phase` で実装済み）
  - firestore.rules の変更（既存の公開読み取り条件を前提に利用するのみ）
- **Adjacent expectations**:
  - 記事の URL 契約は `public-index-page` が定めた `/articles/[topicId]`（`topicId` はトピックの id）に従う
  - 公開判定は `publish-phase` で導入済みの `published` フラグに従い、`publishedAt` は日時表示専用とする
  - firestore.rules は、`topics/{topicId}` が `published == true` のときにその配下（`editedChapters` / `chapters` / `editorial` / `personas` 等）の一般（未認証）読み取りを許可する既存前提に従う
  - 章本文は編集後成果物（`editedChapters`）を優先し、当該章の編集成果物が存在しない場合は原本（`chapters`）にフォールバックする既存の表示方針に従う
  - 記事要素（導入・締め・所感）は統合ドキュメント `topics/{topicId}/editorial/0` を情報源とする
  - 気づき（awareness）はペルソナ文書（`topics/{topicId}/personas/{personaId}`）に埋め込まれ、由来の発話を `triggeredByTurnId` で参照する既存の帰属に従う

- **Design constraints（公開型の分離）**:
  - 公開（閲覧）側のアプリ層データ型は Admin 用の型（`Topic` / `Chapter` / `EditedChapter` / `Editorial*` / `*ForFirestore` / 各種 admin ストア）と**名前も定義も完全に分離**する。公開側の型には必ず **`Published` 接頭辞**を付ける（例: `PublishedArticle` / `PublishedChapter` / `PublishedSpeech` / `PublishedImpression`）。読み取り専用の最小射影とし、表示に必要なフィールドだけを持たせる。
  - 公開コンポーネントおよび公開データ取得は **`Published*` 型のみに依存**し、admin ストア（`editedChaptersStore` / `editorialStore` / `chaptersStore` 等）や `*ForFirestore` 型には依存しない。射影は読み込み境界で永続ドキュメント → `Published*` に変換する（Admin 型を経由しない）。
  - 公開データ取得は `public-index-page` が導入した公開専用 Firestore 経路（`$lib/firebase-public` の `publicDb`・読み取り専用）を用い、Auth/Functions 込みの `$lib/firebase` には依存しない。
  - 見た目は既存の編集プレビュー（`EditingChapter` / `EditingNarration` / `EditingImpression`）を踏襲してよいが、型・データ経路の共有は不可（公開部品として新設する）。

- **Design constraints（目次の現在地強調）**:
  - 目次の現在地（現在の章）の強調は、`<strong>` 等の要素で本文の意味付けを変える形で表現しない。状態を表す CSS クラス／セレクタ＋スタイル指定で表現する（アクティブ状態はスタイルの責務とし、DOM 要素の差し替えで表さない）。

## Requirements

### Requirement 1: 記事本文の構成表示

**Objective:** 閲覧者として、公開された討論を「導入・議論・所感・締め」という読み物として通読したい。複数の立場の意見を筋道立てて理解するため。

#### Acceptance Criteria

1. The 公開記事ページ shall 記事の見出しとして討論のタイトルと公開日（`publishedAt`）を表示する。
2. The 公開記事ページ shall 導入（editorial の intro）・各章の議論・締め（editorial の outro）・各ペルソナの所感（impressions）を、この順序で一連の記事として表示する。
3. The 公開記事ページ shall 章を章の並び順（`chapterIndex`）に従って表示する。
4. Where 各章, the 公開記事ページ shall 章のタイトルとその章の発話（ターン）を表示する。
5. Where 各ペルソナの所感, the 公開記事ページ shall 所感を所感の並び順（`sortOrder`）に従い、対応するペルソナが分かる形で表示する。
6. If 記事要素（導入・所感・締め）のうち内容が存在しないものがある, then the 公開記事ページ shall その要素を出力せず、存在する要素のみで記事を構成する。

### Requirement 2: 発話（ターン）の読み物表示

**Objective:** 閲覧者として、各発話が誰の発言かを分かった上で議論を読みたい。立場の違いを追いながら理解するため。

#### Acceptance Criteria

1. The 公開記事ページ shall 各章の発話を、生成された発話順に表示する。
2. Where 発話がペルソナのもの, the 公開記事ページ shall 発話者としてそのペルソナを識別できる情報（氏名・肩書き等）を発話に添えて表示する。
3. Where 発話がファシリテーターのもの, the 公開記事ページ shall 発話者がファシリテーターであると分かる形で表示する。
4. The 公開記事ページ shall 章本文として編集後成果物（`editedChapters`）を優先して表示する。
5. If ある章の編集後成果物が存在しない, then the 公開記事ページ shall その章について原本（`chapters`）の発話を表示する。
6. The 公開記事ページ shall 発話の読み物本文のみを表示し、管理・診断向けの注釈（ファクトチェックのトレース・信念変化・エンゲージメントスコア等）を閲覧者向け表示に含めない（気づき（awareness）の扱いは Requirement 3 に従う）。

### Requirement 3: 気づき（awareness）のオンデマンド表示

**Objective:** 閲覧者として、討論を読む流れを妨げられずに、必要なときだけ各発話が生んだ気づきを確認したい。他者視点の受容や新たな認識という副次的な情報を、本文とは分けて追えるようにするため。

#### Acceptance Criteria

1. The 公開記事ページ shall 気づき（awareness）を記事本文中に直接展開して表示しない。
2. Where ある発話をきっかけに生じた気づきが1件以上ある, the 公開記事ページ shall その発話に、気づきの存在を示すアフォーダンス（アイコン＋気づきの件数）を表示する。
3. When 閲覧者が発話の気づきアフォーダンスを操作する, the 公開記事ページ shall その発話に紐づく気づきをダイアログで表示する。
4. If ある発話に紐づく気づきが1件も無い, then the 公開記事ページ shall その発話に気づきのアフォーダンスを表示しない。
5. While 気づきダイアログを表示中である, the 公開記事ページ shall 閲覧者がダイアログを閉じて記事本文の閲覧に戻れる手段を提供する。

### Requirement 4: 目次と現在地の強調

**Objective:** 閲覧者として、長い記事のどこを読んでいるかを把握し、章へ素早く移動したい。多くの章を通読する際の見通しを保つため。

#### Acceptance Criteria

1. The 公開記事ページ shall 記事の章立てに対応する目次を左ペインに固定表示する。
2. When 閲覧者が目次の章項目を操作する, the 公開記事ページ shall 記事本文の該当する章へ移動する。
3. While 閲覧者が記事本文をスクロールしている, the 公開記事ページ shall 現在表示中の章に対応する目次項目を強調状態にする。
4. The 公開記事ページ shall 目次項目の強調状態を、CSS のクラス／セレクタ＋スタイル指定で表現し、`<strong>` 等の要素差し替えでは表現しない。

### Requirement 5: 公開記事の特定と公開判定

**Objective:** 閲覧者として、URL で指定した公開済みの討論だけを記事として読めるようにしたい。未公開・不在の記事を誤って閲覧しないため。

#### Acceptance Criteria

1. When 閲覧者が `/articles/[topicId]` にアクセスする, the 公開記事ページ shall 当該 `topicId` の公開済み討論を記事として取得・表示する。
2. If 指定された `topicId` の討論が存在しない, then the 公開記事ページ shall 記事が見つからない旨を提示する（本文を表示しない）。
3. If 指定された討論が未公開（`published` が false または未設定）である, then the 公開記事ページ shall 記事本文を表示せず、記事が見つからない旨を提示する。
4. The 公開記事ページ shall `published` が true の討論配下のデータ（章・記事要素・ペルソナ）のみを取得対象とする。

### Requirement 6: 未認証の閲覧者アクセスと SSR 配信

**Objective:** 閲覧者として、ログインせずに記事を読め、共有・検索で正しく到達できるようにしたい。誰でも自由に多様な意見へアクセスできるようにするため。

#### Acceptance Criteria

1. The 公開記事ページ shall 認証（ログイン）なしで表示できる。
2. While 閲覧者が未認証である, the 公開記事ページ shall 公開済みの討論とその配下データのみを要求し、非公開データや管理専用データ（`chapterAnalysis` / `stakeholders` / `factBase` 等）を要求しない。
3. The 公開記事ページ shall 記事本文をサーバーサイドレンダリング（SSR）で配信する。
4. The 公開記事ページ shall 管理（admin）機能への導線を閲覧者向け表示に含めない。

### Requirement 7: 取得状態の表示

**Objective:** 閲覧者として、読み込み中・記事が無い・取得失敗の状態を明確に知りたい。画面が無言で固まらないようにするため。

#### Acceptance Criteria

1. While 記事データを取得中である, the 公開記事ページ shall 読み込み中であることを示す表示を出す。
2. If 記事が見つからない（不在または未公開）, then the 公開記事ページ shall 記事が見つからない旨のメッセージを表示する。
3. If 記事データの取得に失敗する, then the 公開記事ページ shall 取得に失敗した旨を閲覧者に伝える。

### Requirement 8: 記事のメタ情報

**Objective:** 閲覧者として、記事を共有・検索した際にその記事が適切に表現されてほしい。記事への到達性と信頼性を高めるため。

#### Acceptance Criteria

1. The 公開記事ページ shall 記事ごとに、ページのタイトル・説明・OGP 等のメタ情報を当該記事の内容に基づいて提供する。
2. If 記事が見つからない（不在または未公開）, then the 公開記事ページ shall 記事本文を前提としたメタ情報を出力しない。

### Requirement 9: インデックスへの導線

**Objective:** 閲覧者として、記事を読み終えた後に他の記事を探せるようにしたい。多様な立場の記事を続けて読むため。

#### Acceptance Criteria

1. The 公開記事ページ shall 公開インデックスページ（`/`）へ戻る導線を提供する。

### Requirement 10: レスポンシブ表示

**Objective:** 閲覧者として、PC でもスマートフォンでも読みやすく記事を読みたい。利用環境を問わず快適に通読するため。

#### Acceptance Criteria

1. The 公開記事ページ shall 画面幅に応じてレイアウトを調整し、モバイルとデスクトップの双方で記事本文を読みやすく表示する。
2. While 画面幅が狭い（モバイル相当）, the 公開記事ページ shall 目次を本文の可読性を損なわない形（固定左ペイン以外の配置・折りたたみ等）に適応させる。
