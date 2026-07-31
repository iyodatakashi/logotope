# Research & Design Decisions — public-index-page-redesign

## Summary

- **Feature**: `public-index-page-redesign`
- **Discovery Scope**: Extension（既存の公開トップページを全面リデザイン。データ取得経路は既存のまま、表示・演出・配色機構を刷新）
- **Key Findings**:
  - スクロールに連動した円の拡大縮小は **CSS scroll-driven animation（`animation-timeline: view()`）** で宣言的に実現できる。JS のスクロール監視が不要になり、Req 5.16（パレット再生成が円の追従を妨げない）と Req 8.3（フォーカス追従）が構造的に満たされる。対応は約 85%、`@supports` によるフォールバックが必要。
  - `@14ch/color-palette-generator` は**色相ごとに明度カーブを補正して**トーンを揃える（最も彩度の高い色が 500 番付近に来るように寄せる）。実測で 500 段の明度は色相により 0.61〜0.70 と動く。したがって「色相角だけを動かして明度・彩度を据え置く」分解は成立せず、**生成された色そのものを CSS カスタムプロパティで書き換えて transition する**のが唯一正しい経路。
  - CSS の色トランジションの補間空間は **Oklab（直交系）** が既定で、transition / animation には色空間を指定する構文が無い。中間色の彩度は `cos(Δh/2)` 倍になるため、**1 回の刻みを小さく保つ**ことで実害を回避する。
  - `@14ch/color-palette-generator@1.0.2` の `generateColorPalette` は **HEX 文字列**のパレット（`--{prefix}-50` 〜 `--{prefix}-950` の 11 段 + エイリアス 5 個）を返す。`seedOklch` で OKLCH シードを直接渡せる。`hexToOklch` で各段を OKLCH へ戻せるため、「生成は HEX、CSS へは OKLCH 成分で渡す」という橋渡しが可能。
  - 既存 `PublicTemplate` は `height: 100vh` + 内側 `overflow-y: auto` の内部スクローラを作る。本ページは 2 領域レイアウトで自前のロゴを持つため **`PublicTemplate` を使わない**。記事ページ側は無変更で済み、`view()` のスクローラも文書ルートになって単純化する。

## Research Log

### CSS scroll-driven animations（`animation-timeline`）の適用可否

- **Context**: Req 3 は「スクロール量に対応づけて円を移動・変倍する」「閲覧者の操作なしに位置が変化しない」を求める。JS でスクロール量を読んで `transform` を毎フレーム書く実装と、CSS のスクロール駆動アニメーションのどちらを採るか。
- **Sources Consulted**:
  - MDN: [CSS scroll-driven animations](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations)
  - MDN: [animation-timeline](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/animation-timeline)
  - 各種 2026 年時点のサポート状況記事（下記 References）
- **Findings**:
  - `view()` は「要素がスクロールポートの中でどの位置にいるか」を 0〜1 の進捗として与える。`animation-range` で `entry` / `cover` / `exit` の区間を指定できる。
  - `scroll()` はスクローラ全体の進捗を与える。背景の装飾やページ全体の進行度に向く。
  - スクロール駆動アニメーションはコンポジタ側で処理され、メインスレッドの負荷（本仕様ではパレット再生成）から独立して動く。
  - 2026 年時点でグローバル対応率は約 84〜85%。Chromium 115+、Safari 18+、Firefox は 132 以降で利用可（環境により flag）。`@supports (animation-timeline: view())` での分岐が定石。
- **Implications**:
  - 円の「下で小さい → 中央で標準 → 上で小さい」は `view()` + `animation-range: cover 0% cover 100%` のキーフレームで素直に書ける（Req 3.2–3.4）。
  - 円の上下移動は通常の文書スクロールそのもの。特別な実装は不要（Req 3.1）。同時に Req 4.4（件数に応じたスクロール長）と Req 8.3（フォーカス移動時のスクロール追従）がブラウザ既定の挙動で満たされる。
  - 未対応環境では変倍なしの等倍表示にフォールバックする（Req 8.4 の縮退表示と同じ経路を使える）。

### CSS における色補間の色空間

- **Context**: Req 5.18「補間は CSS に委ねる」、Req 5.12「OKLCH 記法で渡す」。色をカスタムプロパティに書いて transition させたとき、どの色空間で補間されるのかを確認する必要があった。
- **Sources Consulted**:
  - MDN: [`<color-interpolation-method>`](https://developer.mozilla.org/en-US/docs/Web/CSS/color-interpolation-method) — 「When interpolating `<color>` values, the interpolation color space defaults to Oklab.」
  - MDN: [color-mix()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/color-mix)、CSS Color 4 の Hue Interpolation（既定は shorter hue）
  - [@property でカスタムプロパティを transition する](https://dev.to/parsajiravand/you-cant-transition-a-css-variable-property-says-otherwise-50a0)
- **Findings**:
  - `<color>` の補間既定は **Oklab**。MDN の原文: “The interpolation color space defaults to Oklab, but can be overridden through `<color-interpolation-method>` **in some color-related functional notations**.” — 色空間を `in oklch` のように指定できるのは `linear-gradient()` / `color-mix()` などの関数記法だけで、**transition / animation には指定構文が無い**。したがって端点を `oklch()` で書いても補間は Oklab で行われる。
  - OKLCH（極座標）の補間は C を保ったまま h だけが回るため無彩色を通らない。一方 Oklab（直交座標）の補間は円の弦を通るため中間で彩度が落ちる。**落ち幅は色相差に依存し、中点の彩度は元の `cos(Δh/2)` 倍**（30°→97%、60°→87%、120°→50%、180°→0%＝完全な無彩色）。つまり「Oklab だと必ず濁る」わけではなく、**色相差が小さければ実害は無い**。
  - OKLCH の色相補間の既定は shorter hue（短い側の弧）。ただしこれは色空間を明示できる関数記法（`color-mix()` / グラデーション）での挙動であり、transition の既定 Oklab には効かない。
  - HEX / 名前付き色 / `rgb()` / `hsl()` / `hwb()` は「legacy sRGB」として扱われ、互換性のためガンマ符号化 sRGB 空間で補間されうる。`oklch()` 記法で渡せばこの経路を避けられる。
  - カスタムプロパティ自体は（`@property` で型を宣言しない限り）補間されない。ただし**それを参照するプロパティの計算値は変わるため、参照側のプロパティに掛けた `transition` は成立する**。色の移行に `@property` は不要。
- **Implications**:
  - **色そのものを transition の対象にする**。JS はパレットの各段を `oklch(L C H)` 文字列としてカスタムプロパティへ書き、参照側のプロパティ（`background-color` / `color` 等）に `transition` を掛ける。`@property` の登録は不要（Req 5.17, 5.18）。
  - 補間空間は Oklab になるが、1 回の刻みを小さく保てば中間色の彩度低下（`cos(Δh/2)` 倍）は知覚されない（Req 5.20）。色相を分解しないため 0 度またぎという概念自体が発生しない。
  - HEX ではなく `oklch()` 記法で渡す。legacy sRGB 経路での補間を避けるため（Req 5.12）。

### `@14ch/color-palette-generator` の入出力

- **Context**: Req 5.6「色相の算出と色の生成にこのライブラリを用い、独自の色空間変換を実装しない」。実際の API 形状と、CSS へ OKLCH で渡す経路を確認する必要があった。
- **Sources Consulted**: npm パッケージ `@14ch/color-palette-generator@1.0.2` の型定義・README・実行結果（`generateColorPalette` / `hexToOklch` を実際に呼び出して確認）
- **Findings**:
  - `generateColorPalette(config)` の戻り値は `Palette = { [cssVariableName: string]: string }`。実測で 16 キー: `--{prefix}-50` 〜 `--{prefix}-950` の **11 段（HEX 文字列）** と、`--{prefix}-color` / `-lighter` / `-light` / `-dark` / `-darker` の **5 エイリアス（`var(--{prefix}-NNN)` 参照）**。
  - `ColorConfig.seedOklch?: Oklch | null` が用意されており、HEX を経由せず OKLCH シードを直接渡せる。実測: `seedOklch: { mode:'oklch', l:0.55, c:0.15, h:120 }` → `--index-500` が `oklch(0.706, 0.149, 119.9)` 相当の HEX になった（色相は保たれ、明度は `originLevel` の調整カーブで正規化される）。
  - 既定 `hueShiftMode` は `'natural'`。段ごとに色相が最大 30 度までシフトする（明るい段・暗い段で色味を自然に振る）。`'fixed'` にすれば全段が同一色相になる。
  - `hexToOklch(hex)` は `Oklch | undefined` を返す。生成結果（ガマット内の HEX）を OKLCH 成分へ戻すのに使える。
  - `applyColorPaletteToDom(palette)` は **HEX のまま** CSS カスタムプロパティへ書く。本仕様の要件（OKLCH 記法で渡す）とは合わないため使用しない。
  - 依存に `culori` を持つ（OKLCH 変換の実体）。
- **Implications**:
  - 生成は `seedOklch`（色相だけを回した OKLCH）で行い、返った HEX を `hexToOklch` で OKLCH へ戻して `oklch(L C H)` 文字列として CSS へ渡す。「独自の色空間変換を実装しない」（Req 5.6）を満たしつつ、OKLCH 記法での引き渡し（Req 5.12）も満たせる。
  - HEX を経由することでガマットマッピング済みの値が得られる（Req 5.10）。
  - **段ごとの L / C / H はライブラリが決めた組のまま 1 つの色として扱う。**成分に分解して個別に扱わない（下記「色相ごとのパラメータ調整」参照）。
  - エイリアス 5 個は `var()` 参照なので使用しない。役割から段への割り当ては本仕様の CSS 側で行う。

### 色相ごとのパラメータ調整とトーン均衡（設計を訂正した根拠）

- **Context**: 当初の設計は「色相角だけを CSS で補間し、明度・彩度はパレット再生成時に据え置く」としていた。ライブラリの作者であるユーザーから「OKLCH をそのまま回しても視覚的に自然に変化しない。色相ごとに他のパラメータも調整している」と指摘を受け、前提を検証した。
- **Findings**（機構の説明はライブラリ作者＝ユーザーによる。数値は本仕様で実測したもの）:
  - ライブラリの中心的な機能は「同じ段（例: 500）の異なる色相を、知覚的に同程度の強さへ揃える」こと（README「Multi-hue Palette Generation with Tone Balancing」）。
  - **意図的な補正: 明度カーブの色相ごとのシフト。** 色相によって「最も彩度の高い色」が置かれる明度が違う。たとえば黄色は最高彩度の点が非常に明るく、素直に作ると 50 番あたりの明度に来てしまい、他の色相とのバランスが崩れる。この不自然さを補正するため、**最も彩度の高い色が中央（500 番）に近づくよう色相ごとに明度を補正している**。
  - 実測でも、最高彩度の点が明るい側にある色相ほど 500 段の明度が高くなる:

    | 色相 | 500 段の明度 L |
    |---|---|
    | 黄 97° | 0.696 |
    | 緑 142° | 0.688 |
    | 水 202° | 0.691 |
    | 青 262° | 0.616 |
    | 紫 292° | 0.612 |

    同じ段でも色相によって明度が 0.08〜0.11 動く。無視できる差ではない。
  - **暗い段の彩度差はガマット制限による副次的なもの**であり、上記の意図的な補正とは別。実測で 900 段の彩度は 0.054（210°）〜0.150（270°）と約 2.8 倍動くが、これは暗部で保持できる彩度が色相ごとに違うことの反映で、狙って作った差ではない。
- **Implications**:
  - **色相だけを動かして明度・彩度を据え置く実装は誤り**。色相ごとの明度補正が移行の間まったく効かなくなり、その色相に合わない明度で表示され続けたうえ、パレット再生成の瞬間に 0.08〜0.11 の明度差が飛ぶ。ライブラリを使う目的（Req 5.9 のトーン均衡）を実装側が壊すことになる。
  - 生成された色を**分解せず 1 つの色として transition の対象にする**（Req 5.19 として要件化）。
  - 役割（背景／円の面／円の中の文字）を**段の番号で固定**すれば、色相が回っても知覚的な明度差＝コントラスト比はおおむね一定に保たれる。これが Req 5.9 / 5.13 を満たす根拠。実装後に代表的な色相で実測して確認する（Testing 参照）。

### 既存コードとの接続点

- **Context**: 既存の公開経路（`+page.ts` load → `PublishedArticleListPage`）に対して、どこまでを作り替えるか。
- **Findings**:
  - `src/routes/+page.ts` の `load` は `fetchPublishedTopics()` を呼び `{ topics, loadError }` を返す。**変更不要**（Req 10.1–10.3, 10.5 は現状のまま満たされる）。
  - `PublishedTopic = { id, title, publishedAt }`。円の表示に必要なのはこの 3 つのみ。**モデルの拡張は不要**（要件の Boundary で「必要なら拡張」としていたが、実際には不要と確定）。
  - `PublicTemplate.svelte` は `height: 100vh` のグリッドと `overflow-y: auto` の内側スクローラを持ち、ヘッダーにロゴ（`/` へのリンク）を置く。記事ページ（`PublishedArticleDetailPage`）と共有している。
  - 既存 `PublishedArticleListPage` / `PublishedArticleListItem` には `max-width: 720px` / `padding: 32px 16px` / `border: 1px solid #e0e0e0` などのスタイル値が直書きされている（`.kiro/steering/conventions.md` の「コンポーネントにスタイル値を書かない」に違反。Req 9.5 の解消対象）。
  - グローバルスタイルは `src/lib/assets/styles/import.scss` から `variables.scss` / `common.scss` / `material-symbols.scss` を読み込む構成。
- **Implications**:
  - 本ページは `PublicTemplate` を使わない。ロゴは紹介領域が持ち（Req 1.2）、共通ヘッダーのロゴと二重になるのを避ける。`PublicTemplate` は無変更のため記事ページへの影響はゼロ。
  - 内部スクローラが無くなり、スクローラが文書ルートになる。`view()` / `scroll()` のスクローラ指定が単純化し、モバイルの `100vh` 問題も回避できる。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: CSS スクロール駆動 + 色の CSS transition（採用） | 円の変倍は `animation-timeline: view()`、色は JS が間引いてカスタムプロパティへ書き、参照側のプロパティを CSS が transition | JS はスクロール監視と間引き書き込みのみ。変倍はコンポジタ処理で色計算と独立（Req 5.16）。フォーカス追従・スクロール長がブラウザ既定で成立 | scroll-driven animation の対応が約 85%。`@supports` フォールバックが必須 | 要件（5.18 CSS に委ねる／3.7 スクロール量対応）と最も素直に一致 |
| B: JS で毎フレーム `transform` と色を計算 | `requestAnimationFrame` で位置・スケール・色をすべて JS が書く | 対応ブラウザを選ばない | Req 5.18（補間を CSS に委ねる）に真っ向から反する。パレット再生成と変倍が同じメインスレッドに乗り Req 5.16 を満たしにくい | 不採用 |
| C: IntersectionObserver で段階的にクラス付与 | 円が閾値を跨いだらクラスを切り替える | 実装が単純 | 連続的な変倍にならず Req 3.2–3.4 の「中央付近で標準」が階段状になる | 不採用 |

## Design Decisions

### Decision: 円の変倍を CSS scroll-driven animation で行う

- **Context**: Req 3.1–3.9。スクロール量に対応した連続的な変倍が要る。
- **Alternatives Considered**:
  1. `animation-timeline: view()` によるスクロール駆動アニメーション
  2. JS の `scroll` イベント + `requestAnimationFrame` で `transform` を毎フレーム更新
- **Selected Approach**: 各項目に `animation-timeline: view()` と `animation-range` を与え、`@keyframes` で `scale()` を 0%（小）→ 50%（標準）→ 100%（小）と定義する。円の上下移動は通常の文書スクロールに任せる。
- **Rationale**: 宣言的で、値（縮小率・区間）は CSS 変数として外に出せる（Req 9.3）。コンポジタで処理されるため、同時に走るパレット再生成の影響を受けない（Req 5.16）。SSR の DOM と一致し、ハイドレーション後に位置が動かない（Req 10.4）。
- **Trade-offs**: 未対応ブラウザでは変倍が効かない。`@supports (animation-timeline: view())` で分岐し、未対応時は等倍の縦並びリストとして成立させる。
- **Follow-up**: 実装の最初に、対象ブラウザで `view()` が期待どおりの進捗を返すことを実機確認する。

### Decision: 生成された色そのものを CSS カスタムプロパティで書き換え、参照側のプロパティを transition する

- **Context**: Req 5.17–5.21。色は間引いて決め、そこへ滑らかに移行する。移行の間もライブラリが色相ごとに調整した明度・彩度が反映され続けなければならない。
- **Alternatives Considered**:
  1. パレットの各段の色を `oklch()` 文字列でカスタムプロパティへ書き、それを参照する `background-color` / `color` 等を transition する
  2. 色相角だけを `@property syntax: '<angle>'` として transition し、色は CSS 側で `oklch(var(--l) var(--c) calc(var(--hue) + …))` に合成する
  3. 補間率だけを `@property syntax: '<percentage>'` として transition し、`color-mix(in oklch shorter hue, …)` に混色させる
- **Selected Approach**: 1。JS は間引いた頻度でパレットを生成し、各段を `oklch(L C H)` の文字列としてページのルート要素へ書く。CSS 側は役割変数経由でそれを参照し、`background-color` / `color` などに `transition` を掛ける。カスタムプロパティ自体は補間されないが、それを参照するプロパティの計算値が変わるため transition は成立する。`@property` の登録は不要。
- **Rationale**:
  - **案 2 は誤り**。ライブラリは色相ごとに明度・彩度・段ごとの色相シフトを作り替えてトーンを揃えている。実測（同一シード L=0.6 / C=0.15 で色相のみ変化）では、500 段の明度が 0.596（270°）〜0.706（120°）で 0.11 の幅、900 段の彩度が 0.054（210°）〜0.150（270°）で約 3 倍動く。色相だけを動かして L / C を据え置くと、**移行中はずっとその色相に合わない明度で表示され、再生成の瞬間に 0.11 の明度差が飛ぶ**。ライブラリを使う目的（Req 5.9 のトーン均衡）を実装が壊す。
  - 案 3 は端点の付け替え管理が要り、色相が回り続ける用途に合わない。
  - 案 1 は L / C / H が一体で移行するため、色相ごとの調整が移行の間も連続的に反映される。実装も最も単純で、`@property` に伴う不確実性（Svelte のスコープ処理・ブラウザ対応）が消える。
- **Trade-offs**: transition の補間空間は Oklab（直交系）となり、1 ステップの色相差に応じて中間色の彩度が `cos(Δh/2)` 倍に落ちる。1 回の刻みを小さく保つことで知覚されない範囲に収める（Req 5.20 として要件化済み）。刻みを大きくしたい場合はこのトレードオフが顕在化するため、値の調整時に留意する。
- **Follow-up**: 実装後、間引き幅を変えたときに中間色のくすみが知覚されるかを確認し、許容できる刻みの上限をコメントで残す。

> 補足: 本ライブラリの作者はユーザー本人であり、色相ごとのパラメータ調整の意図はユーザーの説明を一次情報とする。本節の実測値はその裏付けとして記録したもの。

### Decision: `PublicTemplate` を使わない

- **Context**: Req 1.1–1.2（2 領域構成・紹介領域がロゴを持つ）と、Boundary の「`PublicTemplate` を変更するなら記事ページ側も成立させる」。
- **Alternatives Considered**:
  1. `PublicTemplate` の中に 2 領域レイアウトを入れる
  2. 本ページ専用のレイアウトを持ち、`PublicTemplate` は記事ページ専用として無変更にする
- **Selected Approach**: 2。
- **Rationale**: 案 1 は共通ヘッダーのロゴと紹介領域のロゴが二重になる。また `PublicTemplate` の内側スクローラ（`height: 100vh` + `overflow-y: auto`）が `view()` のスクローラとなり、モバイルのビューポート高問題を持ち込む。案 2 なら `PublicTemplate` は 1 文字も変えずに済み、記事ページへの波及がゼロになる。
- **Trade-offs**: 公開ページ間で共通の枠を持たなくなる。ただし本ページはロゴ・概要を自前で持つため、共有すべき要素が実質的に無い。
- **Follow-up**: なし。

### Decision: 役割から段への割り当てを 1 か所の「デザイン値ブロック」に集約する

- **Context**: `.kiro/steering/conventions.md`「コンポーネントにスタイル値を書かない」。一方で、どの段（500 / 900 など）をどの役割に使うかは配色の決定そのもの。
- **Selected Approach**: コンポーネントは意味づけされた役割変数（`--published-article-list-surface` など）だけを参照する。役割変数から段への割り当てと、JS 未実行時のフォールバック色は、**page コンポーネントの `<style>` 先頭にある「デザイン値」ブロック 1 か所**にまとめ、ユーザーが編集する前提であることをコメントで明示する。
- **Rationale**: 値を消し去ることはできない（画面が描画されない）ため、「値が 1 か所に集まっていて、他のどこにも散らばっていない」状態を目標にする。
- **Trade-offs**: 初期値は暫定であり、ユーザーの調整を前提とする。

## Risks & Mitigations

- **scroll-driven animation 未対応環境（約 15%）で変倍が効かない** — `@supports` で等倍の縦並びリストへフォールバックし、リンクと情報は完全に保つ（Req 8.1–8.2）。フォールバックは `prefers-reduced-motion` 時の縮退表示と同じ経路にして分岐を増やさない。
- **`transition` の宣言位置を誤ると色が飛ぶ** — 色を運ぶカスタムプロパティはルート要素に書かれ子孫へ継承される。`transition` は**色を実際に適用する各要素**に置く必要がある。実装開始時に実機で確認する。
- **装飾の円の配置ルールが暫定（乱数）** — まず視覚表現が成立するかの確認を優先し、位置・大きさ・視差量は乱数で決める。乱数は SSR とクライアントで食い違うため、装飾レイヤーはクライアントでのみ描画する。実物を見たうえで決定的なルールへ差し替えるか判断し、差し替え時はクライアント限定描画の分岐を外す。
- **色計算の依存が初回バンドルに載る（対応は保留）** — `@14ch/color-palette-generator` と `culori` を静的 import するため公開トップの初回 JS が増える。`$effect` 内の動的 `import()` で外すことは可能だが、**実測せずに複雑さを足さない**。実装後にバンドルサイズと初回表示を測り、問題があればそのとき対応する。
- **間引き幅を大きくすると中間色がくすむ** — transition の補間空間は Oklab のため、1 ステップの色相差 `Δh` に対して中間色の彩度が `cos(Δh/2)` 倍になる。刻みを小さく保ち、許容できる上限を実測してコメントに残す。
- **色相によってコントラストが不足する** — 役割を段で固定し、色相を 12 分割程度でサンプリングしてコントラスト比を実測する。不足があれば段の割り当てを見直す（値の調整で解決する）。
- **円の重なりでタイトルが読めなくなる** — 重なりは許容する方針（Req 3.11）。重なりはレイアウト上のスロット高を直径より小さく取ることで生じ、量はその 1 値で決まる。手前の円が不透明であること、重ね合わせ順が文書順で決まることで手前の可読性を保つ（Req 3.12）。
- **記事が 1 件のときスクロールが成立しない** — 円が流れる領域の高さを「件数 × 間隔 + 前後の余白」で決め、1 件でも中央到達までのスクロールが生じるようにする。余白は値としてユーザーが決める。

## References

- [CSS scroll-driven animations — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations) — `view()` / `scroll()` / `animation-range` の仕様
- [animation-timeline — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/animation-timeline) — タイムライン指定の構文
- [`<color-interpolation-method>` — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/color-interpolation-method) — `<color>` 補間の既定が Oklab であることの根拠
- [color-mix() — MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/color-mix) — 色相補間（shorter hue 既定）
- [You can't transition a CSS variable. @property says otherwise.](https://dev.to/parsajiravand/you-cant-transition-a-css-variable-property-says-otherwise-50a0) — 登録済みカスタムプロパティの補間
- [Scroll-Driven Animations — Josh W. Comeau](https://www.joshwcomeau.com/animation/scroll-driven-animations/) — 実装パターンとフォールバック方針
- [Creating Complex Scroll-driven Animations with Pure CSS in 2026](https://dev.to/nickbenksim/creating-complex-scroll-driven-animations-with-pure-css-in-2026-17l) — 2026 年時点のサポート状況
- [svelte/motion — prefersReducedMotion](https://svelte.dev/docs/svelte/svelte-motion) — Svelte 5 のリデュースドモーション判定
- npm `@14ch/color-palette-generator@1.0.2` — 型定義・README・実行確認（本ドキュメントの「入出力」節に実測値を記録）
