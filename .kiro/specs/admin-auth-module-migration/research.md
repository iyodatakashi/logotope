# Research & Design Decisions: admin-auth-module-migration

## Summary

- **Feature**: `admin-auth-module-migration`
- **Discovery Scope**: Complex Integration（リポジトリ外の未公開モジュールを取り込み、認証の担当をそちらへ移す）
- **Key Findings**:
  - モジュールの依存元 spec は**アプリ全体が保護対象の別アプリ（markn）向け**に書かれており、「根の `+layout.svelte` に `AuthGate` を1つ」を前提とする。公開ページを持つ logotope はこの前提を満たさない。判定の実装（`resolveAuthGuard`）は経路の完全一致だけを見るため**部分木への配置でも成立する**が、モジュール側の文書に裏づけが無い。
  - 版の引き上げ3件（`@sveltejs/kit` 2.56→2.63 / `firebase` 12.14→12.18 / `@14ch/svelte-ui` 0.0.58→0.0.61）は、**いずれも本プロジェクトが使う面に破壊的変更が無い**ことを一次情報で確認した。
  - モジュール README の Vite 設定はそのままでは logotope に適用できない。pnpm の非フラットな `node_modules` では再包含の `include: ['dompurify']` が**解決に失敗する**（root から `dompurify` を解決できないことを確認済み）。

## Research Log

### `AuthGate` を部分木（`/admin`）に置けるか

- **Context**: 要件 4.1 / 4.2。logotope は公開ページ（`/`・`/articles/**`）を持ち、モジュールは根への配置を前提としている
- **Sources Consulted**:
  - `~/workspace/SvelteFirebaseAuth/svelte-firebase-auth/src/lib/models/auth/authGuard.ts`（実装）
  - 同 `.kiro/specs/sveltekit-routing-and-guard/requirements.md:30`、`design.md:434`、`research.md:38-47`
- **Findings**:
  - `resolveAuthGuard` は `stage` / `currentPath` / `routes` / `returnTo` だけを見る純関数で、**アプリの根を参照しない**。`signed-out` では認証4経路以外を `routes.signIn` へ振り替える
  - 依存元 spec の「組み込み側へ返す事項」に「根の `+layout.svelte` で `AuthGate` を1つ置く」と書かれている。**理由は「段階から遷移への対応づけを組み込み側で書かせない」ことであり、「根でなければならない」ことの根拠は示されていない**
  - `design.md:434` の制約も「組み込み側は根の `+layout.svelte` で子を包む（要件 1-4）」と要件を引くだけで、部分木を否定する記述は無い
  - 実際の依存は `page.url`（`$app/state`）と `store.stage` のみ。`AuthGate` がマウントされた部分木の中でだけ判定が走る
- **Implications**: `/admin/+layout.svelte` への配置は成立する。ただし**モジュールの文書に無い使い方**であり、モジュール側の変更で前提が崩れうる。design に記録し、モジュールへ返す（→ Risks）

### 版の引き上げに破壊的変更があるか

- **Context**: 要件 1.7。peer 要求は `@sveltejs/kit ^2.63.0` / `firebase ^12.18.0` / `@14ch/svelte-ui ^0.0.61`、実際のインストールは 2.56.1 / 12.14.0 / 0.0.58
- **Sources Consulted**:
  - [sveltejs/kit CHANGELOG](https://github.com/sveltejs/kit/blob/main/packages/kit/CHANGELOG.md)（2.57.0〜2.63.1）
  - [firebase-js-sdk CHANGELOG](https://github.com/firebase/firebase-js-sdk/blob/master/packages/firebase/CHANGELOG.md)（12.15〜12.18）
  - `~/Documents/workspace/Web_Workspace/svelte-ui/CHANGELOG.md`（0.0.59〜0.0.61）
- **Findings**:
  - **kit 2.57〜2.63 の breaking はすべて remote functions（実験的機能）に閉じる**（2.58 の `requested()`、2.59 の `refresh()`、2.61 の `.run()` 廃止）。logotope は remote functions を使っていない。2.63.0 は explicit environment variables の追加（任意機能）
  - **firebase 12.15〜12.18 に auth の破壊的変更は無い**。12.18.0 で Imagen のメソッド・型が削除されたが、**logotope は Imagen を使っていない**（`firebase/vertexai` / `getImagen` の参照が無いことを確認）
  - **svelte-ui 0.0.59 / 0.0.60 / 0.0.61 はいずれも Fixed のみ**（Input / Textarea の表示位置とスクロールバー）。breaking は 0.0.57（props の厳格化）で、0.0.58 で既に取り込み済み
- **Implications**: 3件とも Low risk。ただし `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` が `@14ch/svelte-ui@0.0.58` までしか列挙していないため、0.0.61 の追加が要る

### Vite の事前バンドルをどう設定するか

- **Context**: 要件 1.8。モジュール README は `optimizeDeps.exclude` と `resolve.dedupe` を必須とするが、logotope は設定なしで `@14ch/svelte-ui`（同じく `.svelte` 生配布）を動かしている
- **Sources Consulted**:
  - `node_modules/@sveltejs/vite-plugin-svelte/src/utils/options.js:149, 392-419, 494-497`
  - `node_modules/@14ch/svelte-ui/package.json`（依存: `dayjs` / `dompurify` / `sass`）
  - `node -e "require.resolve('dompurify')"` の結果
- **Findings**:
  - `prebundleSvelteLibraries` の既定は `!isBuild` = **開発時 true / ビルド時 false**。開発時は svelte ライブラリが事前バンドルされ、そのとき自動の exclude は空にされる（`options.js:494-497`）。logotope が設定なしで動いているのはこのため
  - README が exclude を必須とするのは、**モジュール側が自身をリンクした環境で `svelte` の実体が二重になる問題**に対する対処と読める。`resolve.dedupe: ['svelte']` はこの二重化そのものへの対処
  - exclude すると、除外したパッケージの CJS 依存が変換されずに残るため再包含が要る。README は `include: ['dayjs', ..., 'dompurify']` を挙げる
  - **pnpm の非フラットな `node_modules` では、root から `dompurify` を解決できない**（`MODULE_NOT_FOUND` を確認）。`dompurify` は `@14ch/svelte-ui` の依存であり `node_modules/.pnpm/dompurify@3.4.11` に置かれている。`dayjs` は logotope の直接依存なので解決できる
- **Implications**: README の設定をそのまま写すと `include: ['dompurify']` が壊れる。**vite-plugin-svelte の再包含記法 `'@14ch/svelte-ui > dompurify'` を使う**。加えて、`link:` を使う開発中は exclude と dedupe を入れ、npm 公開版に切り替えた後も同じ設定で害が無いことを確認する

### 依存をどう取り込むか

- **Context**: 要件 1.6。モジュールは npm 未公開、GitHub にもリポジトリが無く、実体は logotope のリポジトリ外（`~/workspace/SvelteFirebaseAuth/`）
- **Sources Consulted**: `npm view @14ch/svelte-firebase-auth`（404）、`gh repo list`（該当なし）、モジュールの `.gitignore:10`（`/dist`）、`apphosting.yaml`
- **Findings**:
  - Firebase App Hosting はリポジトリの内容からビルドする。リポジトリ外への `link:` / `file:` は**ビルド環境に存在せず解決に失敗する**
  - モジュールの `dist/` は `.gitignore` されており git に含まれない。git 依存にするなら `prepare` でのビルドが要る
  - `@14ch/svelte-ui` は npm 公開版として取り込まれており、既存の運用に前例がある
- **Implications**: 完了の条件は npm 公開版での解決。開発中の `link:` は作業手段であって到達点ではない

### `AuthGate` をどう検証するか

- **Context**: 要件 10.5。モジュールの design は「`AuthGate` は単体では試験しない（ルーター無しでは `goto` が例外を投げる）。E2E で確かめる」と定めている
- **Sources Consulted**: モジュールの `.kiro/specs/sveltekit-routing-and-guard/design.md`（AuthGate の Implementation Notes）、logotope の `package.json`、`src/tests/features/public/article-list/article-list-public-behavior.test.ts`
- **Findings**:
  - 判定の本体（`resolveAuthGuard`）は純関数で、**モジュール側に単体試験がある**。logotope が再検証する対象ではない（`.kiro/steering/spec-dependencies.md`「受け入れ基準は依存元のものを使う」）
  - logotope に E2E の土台が無い（`playwright` は devDependency にあるが `test:e2e` スクリプトが無い）
  - logotope には**ソースを正規表現で走査して混入を禁じる検査**の前例がある（`article-list-public-behavior.test.ts`）。配置の誤りはこの手法で捕捉できる
- **Implications**: logotope が担保すべきは「判定が正しいか」ではなく「**`AuthGate` が正しい位置にあり、公開経路に混入していないか**」。既存の走査型検査を拡張する

## Architecture Pattern Evaluation

| Option | 説明 | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 部分木ゲート（採用） | `AuthGate` を `/admin/+layout.svelte` に置き、認証の4経路も `/admin` 配下に置く | 公開ページが自然に対象外。`ssr = false` の範囲と一致 | モジュールの文書に無い使い方 | 判定が経路の完全一致だけを見ることを実装で確認済み |
| 根ゲート | README どおり根の `+layout.svelte` に置く | モジュールの想定どおり | **公開ページが振り替えられ、要件 4.2 に反する** | 成立しない |
| ルートグループ分離 | `(public)` / `(admin)` でレイアウトを分ける | 境界がディレクトリに現れる | 既存の全ルートに波及。本 spec の範囲を超える | 将来の整理として保留 |

## Design Decisions

### Decision: `AuthGate` を `/admin/+layout.svelte` に置く

- **Context**: 要件 4.1 / 4.2。公開ページを振り替えの対象にできない
- **Alternatives Considered**:
  1. 根の `+layout.svelte` — `signed-out` で公開ページがサインインへ振り替えられ、成立しない
  2. ルートグループで分離 — 既存の全ルートに波及し、本 spec の範囲を超える
- **Selected Approach**: `/admin/+layout.svelte` で子を `AuthGate` で包む。認証の4経路をすべて `/admin` 配下に置く
- **Rationale**: `resolveAuthGuard` は経路の完全一致だけを見るため部分木で成立する。`/admin` は既に `ssr = false` で、ブラウザでのみ働く `AuthGate` の性質と一致する
- **Trade-offs**: モジュールの文書に無い使い方であり、モジュール側の変更で前提が崩れうる
- **Follow-up**: 配置をソース走査の検査で固定する。モジュール側へ「部分木への配置」を返す

### Decision: 依存は npm 公開版を正とし、`link:` は開発中の手段に限る

- **Context**: 要件 1.6。App Hosting のビルドがリポジトリ外を解決できない
- **Alternatives Considered**:
  1. `link:` のまま — デプロイで壊れる
  2. GitHub の git 依存 — リポジトリが存在せず、`dist/` も git に無いため `prepare` でのビルドが要る
- **Selected Approach**: `@14ch/svelte-firebase-auth` を npm へ公開し、`@14ch/svelte-ui` と同じ扱いで依存に加える。実装中は `link:` で往復し、**公開版への切り替えを完了の条件とする**
- **Rationale**: 既存の運用（svelte-ui）に前例があり、版を固定できる
- **Trade-offs**: モジュール側の修正のたびに publish が要る。`minimumReleaseAgeExclude` の運用が増える
- **Follow-up**: `pnpm-lock.yaml` にローカルパスが残らないことを確認する

### Decision: context の受け渡しだけを行う薄い層を logotope 側に1つ置く

- **Context**: 要件 2.1 / 10.4。モジュールのストアはインスタンスで `setContext` 前提だが、既存の 7 spec は `vi.mock('$lib/stores/auth.svelte.js')` でモジュールレベルのシングルトンを差し替えている
- **Alternatives Considered**:
  1. コンポーネントが直接 `getContext('authStore')` を呼ぶ — 単体で描画する spec では context が空になり 7 本が壊れる。キー文字列が各所に散る
  2. `store` を props で流す — prod ドリリングが発生し、`.kiro/steering/conventions.md` が明示的に避けている形
  3. logotope 側でモジュールレベルのシングルトンとして生成 — 寿命を階層に束ねられず要件 2.3 と衝突。import しただけで生成が走り公開バンドルへ混入しうる（要件 10.3 に抵触）
- **Selected Approach**: `src/lib/stores/adminAuth.svelte.ts` が `setAdminAuthStore` / `getAdminAuthStore` の2つだけを公開し、内部で `setContext` / `getContext` を呼ぶ
- **Rationale**: コンポーネントの読み方が「1つの import」で現状と同じになり、spec は mock 先を差し替えるだけで済む。context のキーが1か所に閉じる
- **Trade-offs**: モジュールの `AuthStore` の上に層が1枚増える。**この層は状態も操作も持たず受け渡しだけを行う**ことを design で明示し、要件 1.1 との境界を保つ
- **Follow-up**: この層に認証の判断（段階の解釈・遷移）が混入していないことをレビューで確認する

### Decision: 管理データの購読の寿命を `AuthGate` の内側の包みに持たせる

- **Context**: 要件 4.7 / 6.4。現行は `/admin/+layout.svelte` の `$effect` が `authStore.user` を見て `topicsStore` を開始・停止している。要件 4.7 は logotope 側に段階を見た分岐を置くことを禁じる
- **Findings**: `AuthGate` は `decision.kind === 'allow'` のときだけ children を描画する（実装で確認）。**到達を許された間だけ存在する場所が、ゲートの内側に自然にできる**
- **Alternatives Considered**:
  1. レイアウトで `store.isLoggedIn` を読んで開始する — 段階を見た分岐そのもので、要件 4.7 に反する
  2. 決めずに実装時の選択として残す — `.kiro/steering/spec-dependencies.md`「設計の空白は必ず埋められる。誤った内容で」に該当する。**design レビューで指摘され、ここで決め切った**
- **Selected Approach**: `AdminDataScope.svelte` を `AuthGate` の内側に置き、`$effect` で `topicsStore.start()` を呼び後始末で `stop()` を返す。条件式を持たない
- **Rationale**: 購読の寿命がマウントの寿命と一致し、開始も停止も認証の状態を読まずに得られる。サインアウトでゲートが children を外すため、要件 6.4 が副作用として満たされる
- **Trade-offs**: 包みが1層増える。マークアップを持たないため描画への影響は無い
- **Follow-up**: この包みに認証への参照が入っていないことをソース走査の検査で固定する

### Decision: `emailVerification: false` とし、`verifyEmail` の経路と画面は用意する

- **Context**: 要件 8.1。`AuthRoutes.verifyEmail` は型として必須だが、確認を求めない設定では到達しない
- **Alternatives Considered**:
  1. 経路の値だけ与えて画面を置かない — 直接 URL を開いたとき、`AuthGate` の振り替えと SvelteKit の 404 のどちらが先かが未確定
  2. `verifyEmail` に `signIn` と同じ値を与える — 型は満たすが、設定を読んだ人が意図を誤解する
- **Selected Approach**: `/admin/verify-email` を用意し `VerifyEmail` を置く。`emailVerification: false` のため到達しない
- **Rationale**: 画面1つのコストは小さく、挙動が未確定な経路を残さない。後で `true` へ切り替えるときに何も足さずに済む
- **Trade-offs**: 到達しない画面が1つ残る
- **Follow-up**: `emailVerification` を `true` へ変える判断が出たら、Firestore ルールへの `email_verified` 追加と既存アカウントの移行が併せて要る

### Decision: `signUp` は経路を実在させず、`signIn` の値を重ねる

- **Context**: 要件 3.1 / 7.1。`AuthRoutes` は全項目必須だが、自由登録を行わないため登録の経路を持たない
- **Findings**: **`SignUp.svelte` は `canSelfRegister` を参照せず、無条件でフォームを描画する**（実装で確認）。`resolveAuthGuard` は `signed-out` の段階で登録の経路への到達を許す。したがって `/admin/signup` を実在させると、URL を直接開いた者に登録フォームが出る
- **Alternatives Considered**:
  1. `/admin/signup` を実在させ `SignUp` を置く — 上記により要件 7.1（登録の入口を画面に出さない）に反する。**design レビューで一度この案を推したが、実装を確認して棄却した**
  2. `/admin/signup` を実在させ、`SignUp` 以外の何かを置く — 経路の意味と中身が食い違い、読み手を欺く
- **Selected Approach**: `signUp` に `signIn` と同じ値（`/admin/login`）を与え、経路を実在させない
- **Rationale**: `matchesAny` / `isAuthRoute` はサインインの経路として扱うため振り替えの循環は生じない。**到達しない経路の扱いは、到達しない理由で分ける**（`verifyEmail` は設定の帰結なので実在させる／`signUp` は到達させてはならないので実在させない）
- **Trade-offs**: 設定の値が重複する。判断の規則を design に明記して補う
- **Follow-up**: `/admin/signup` が生まれていないことをソース走査の検査で固定する

### Decision: `continueUrl` は管理画面のサインインの経路を指す

- **Context**: 要件 2.5 / 9.1。`continueUrl` は Firebase の既定のアクションハンドラを経た利用者の着地先になる
- **Findings**: モジュールは `{ url: config.continueUrl }` を `ActionCodeSettings` として `sendPasswordResetEmail` に渡す。サイトの根を与えると、パスワードを再設定した管理者が**公開の記事一覧へ着地する**
- **Alternatives Considered**: アプリのオリジンをそのまま与える — 復旧経路の最後で管理画面から放り出される。要件 2.5 に反する
- **Selected Approach**: 環境変数はオリジン（`VITE_APP_ORIGIN`）だけを持ち、`continueUrl` は `${VITE_APP_ORIGIN}/admin/login` として組み立てる
- **Rationale**: 着地先をサインインの経路にすれば、着地した利用者が既にサインイン済みでも `AuthGate` が `ready` と判定して `afterSignIn` へ送る。経路の分岐を持たずに両方の場合を扱える
- **Follow-up**: このドメインが Firebase の承認済みドメインに含まれていることを確認する

### Decision: `afterSignIn` は `/admin/topics` とする

- **Context**: 要件 3.5。`/admin` に `+page.svelte` が無く 404 になる
- **Alternatives Considered**: `/admin` に `+page.svelte` を新設して `afterSignIn` を `/admin` にする — 本 spec の範囲外の画面追加になる
- **Selected Approach**: `afterSignIn: '/admin/topics'`
- **Rationale**: 実在する画面であり、現行の到達先（トピック一覧）と一致する。現行の `sanitizeAdminRedirect` が `/admin`（404）へ落としていた既存の不具合も同時に解消する
- **Trade-offs**: `/admin` を直接開いた場合の 404 は残る（本 spec の範囲外）

### Decision: Vite の再包含は pnpm 向けの記法で書く

- **Context**: 要件 1.8。README の設定をそのまま写すと pnpm で壊れる
- **Alternatives Considered**: `optimizeDeps` を設定しない — 開発時は事前バンドルが働き現に動くが、`link:` 使用時の svelte 二重化に対処できない
- **Selected Approach**: `optimizeDeps.exclude` に2つのパッケージを挙げ、再包含は `'@14ch/svelte-ui > dompurify'` の形で書く。`dayjs` は直接依存なのでそのまま挙げてよい。`resolve.dedupe: ['svelte']` を加える
- **Rationale**: pnpm の非フラットな `node_modules` では root から `dompurify` を解決できないことを確認済み
- **Follow-up**: 開発サーバーとビルドの両方で描画を確認する

### Decision: `AuthGate` の判定は上流に委ね、logotope は配置を検査する

- **Context**: 要件 10.3 / 10.5。`AuthGate` は単体試験ができず、logotope に E2E の土台が無い
- **Alternatives Considered**:
  1. logotope に Playwright の E2E を新設する — 土台ごと作ることになり本 spec の範囲を超える
  2. 何も検査しない — 配置の誤り（公開側への混入・包み忘れ）が黙って通る
- **Selected Approach**: 判定の正しさはモジュール側の単体試験に委ねる。logotope はソース走査の検査で「`AuthGate` が `/admin/+layout.svelte` にあり、公開経路のソースに認証のコードが無い」ことを固定する。実挙動はエミュレータでの手動確認で担保する
- **Rationale**: `.kiro/steering/spec-dependencies.md`「受け入れ基準は依存元のものを使う」に沿う。走査型の検査は logotope に前例がある
- **Trade-offs**: 振り替えの実挙動が自動検査で守られない。**手動確認の項目を tasks に明示的に置く**

## Risks & Mitigations

- **モジュールの想定外の配置（部分木）が、モジュール側の変更で崩れる** — design に配置の根拠（判定が経路の完全一致だけを見る）を記録し、モジュール側へ「部分木への配置」を返す。配置はソース走査の検査で固定する
- **npm 公開版へ切り替えないままデプロイし、ビルドが壊れる** — 公開版での解決を完了の条件として tasks に置き、`pnpm-lock.yaml` にローカルパスが残らないことを確認する
- **`optimizeDeps.exclude` の追加で `@14ch/svelte-ui` の既存の描画が壊れる** — 再包含を pnpm の記法で書き、開発サーバーとビルドの両方で確認する
- **`continueUrl` のドメインが Firebase の承認済みドメインに無く、再設定メールが送れない** — 実装前にコンソールで確認する運用項目として tasks に置く（`auth/unauthorized-continue-uri` が兆候）
- **7 本の spec の mock 差し替えを取りこぼす** — `$lib/stores/auth.svelte` の削除により import が解決できなくなるため、取りこぼしは型検査とテストの失敗として現れる

## References

- [sveltejs/kit CHANGELOG](https://github.com/sveltejs/kit/blob/main/packages/kit/CHANGELOG.md) — 2.57〜2.63 の breaking が remote functions に閉じることの確認
- [firebase-js-sdk CHANGELOG](https://github.com/firebase/firebase-js-sdk/blob/master/packages/firebase/CHANGELOG.md) — 12.15〜12.18 に auth の破壊的変更が無いことの確認
- `~/workspace/SvelteFirebaseAuth/svelte-firebase-auth/README.md` — 組み込みの手引き（Vite 設定・経路・`AuthGate`）
- `~/workspace/SvelteFirebaseAuth/svelte-firebase-auth/.kiro/specs/sveltekit-routing-and-guard/` — 到達の制御の要件・設計・決定
- `~/Documents/workspace/Web_Workspace/svelte-ui/CHANGELOG.md` — 0.0.59〜0.0.61 が Fixed のみであることの確認
