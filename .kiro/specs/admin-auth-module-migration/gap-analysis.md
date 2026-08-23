# Gap Analysis: admin-auth-module-migration

## 1. 現状調査（Current State）

### 差し替え対象の資産（logotope 側）

| ファイル | 現在の役割 | 差し替え後 |
|---|---|---|
| `src/lib/stores/auth.svelte.ts` | グローバルな `authStore`（import 時に購読開始） | **削除**。`createAuthStore(auth, config)` へ |
| `src/lib/utils/redirect.ts` | `sanitizeAdminRedirect`（オープンリダイレクト防止） | **削除**。`returnTo.ts` の `isSafeReturnTo` が同じ役割 |
| `src/tests/utils/redirect.test.ts` | 上のテスト | **削除** |
| `src/routes/admin/+layout.svelte` | 到達ガード＋`?redirect=` 付与＋`topicsStore` の寿命 | ガードを撤去し、`AuthGate` で包む。ストアの生成と寿命を持つ |
| `src/routes/admin/login/+page.svelte` | ログインフォームの実体（規約違反） | `<SignIn {store} />` の最小ラッパーへ |
| `src/lib/features/admin/AdminTemplate.svelte` | `authStore.isLoggedIn` でログアウト表示、`authStore.user` で子を出し分け | 出し分けは `AuthGate` が担うため撤去。ログアウトのみ残す |
| `src/lib/firebase.ts` | `app` / `auth` / `db` / `functions` の初期化＋エミュレータ接続 | **維持**。`auth` をモジュールへ渡す |
| `firestore.rules` | `request.auth != null` | **維持**（要件 8-4 / 10-1） |
| `functions/src/utils/auth.ts` | `requireAuth` | **維持** |

### 差し替え元モジュールの公開面（実物で確認）

`~/workspace/SvelteFirebaseAuth/svelte-firebase-auth` — `@14ch/svelte-firebase-auth@0.0.1`。

- `createAuthStore(auth, config)` / `normalizeEmail` / `jaMessages` / `resolveMessages` / `authErrorMessageOf`
- `AuthGate`（到達の制御）、`SignIn` / `SignUp` / `VerifyEmail` / `PasswordChange` / `PasswordReset`
- 型: `AuthConfig` / `AuthRoutes` / `AuthStage` / `AuthStore` / `AuthError` / `AuthResult` / `AuthMessages` ほか
- 画面の props は全て `AuthBaseProps`（`store` / `messages` / `header`）のみ。**コールバックは受け取らない**

### 検証済みの重要事実

1. **モジュールの依存元 spec は別アプリ（markn）向けに書かれている。** `sveltekit-routing-and-guard/requirements.md:30` は「根の `+layout.svelte` で `AuthGate` を1つ置く」を組み込み側へ返す事項として明記する。**markn はアプリ全体が保護対象であり、公開ページを持つ logotope とは前提が異なる。**
2. **`resolveAuthGuard` は `signed-out` のとき、認証の4経路以外のすべてをサインインへ振り替える**（`src/lib/models/auth/authGuard.ts`）。README どおり根に `AuthGate` を置くと、`/` と `/articles/**` が未サインインの閲覧者に対してサインインへ振り替えられる。**要件 4-2 の成否はこの配置で決まる。**
3. **`dist/` は配布可能な形にビルド済み。** `$lib/` は相対パスへ書き換えられ、`$app/navigation` / `$app/state` はそのまま残る（組み込み側の SvelteKit が解決する）。`.svelte` のまま配布される。
4. **`@14ch/svelte-ui` も `.svelte` を生で配布しており、logotope は `optimizeDeps.exclude` 無しで現に動いている。** `@sveltejs/vite-plugin-svelte` が `svelte` の export 条件を持つ依存を自動で除外するため。README の Vite 設定が logotope で追加で必要かは未確定（→ Research）。
5. **`/admin` に `+page.svelte` が無い。** `src/routes/admin/` は `+layout.*` と `login/` と `topics/` だけで、`/admin` 単体は 404 になる。現行の `sanitizeAdminRedirect` はフォールバック先を `/admin` としており、**既存のバグである**。`AuthRoutes.afterSignIn` は `/admin/topics` を指す必要がある。
6. **logotope に `getContext` / `setContext` の使用実績がゼロ。** 認証ストアの共有で初めて導入する。既存のストアはすべてモジュールレベルのシングルトン（`export const topicsStore = create()`）。
7. **版のズレ。** 実際にインストールされているのは `@sveltejs/kit 2.56.1` / `firebase 12.14.0` / `@14ch/svelte-ui 0.0.58` / `svelte 5.55.1`。モジュールの peer 要求は `^2.63.0` / `^12.18.0` / `^0.0.61` / `^5.0.0` で、**前者3つが不足**。
8. **`pnpm-workspace.yaml` の `minimumReleaseAgeExclude` が `@14ch/svelte-ui@0.0.58` までしか列挙していない。** 0.0.61 へ上げるにはこの列挙の更新が要る。
9. **モジュールは npm 未公開で、GitHub にもリポジトリが無い**（`npm view @14ch/svelte-firebase-auth` → 404、`gh repo list` に該当なし）。リポジトリの実体は `~/workspace/SvelteFirebaseAuth/` にあり、**logotope のリポジトリの外にある**。
10. **`continueUrl` に相当する環境変数が無い。** `.env` / `apphosting.yaml` は Firebase の6項目だけを持つ。アプリ自身の URL は定義されていない。

### テスト資産

- `$lib/stores/auth.svelte.js` を `vi.mock` する spec が **7 本**（`TopicListPage` / `ThemePage` / `GeneratePersonaPage` / `FactResearchPage` / `GenerateChaptersPage` / `GenerateDebatePage` / `EditingPage` / `PublishPage`）。いずれも `{ logout, user, isLoggedIn }` の形。
- `src/tests/features/public/article-list/article-list-public-behavior.test.ts` が、公開経路のソースを正規表現で走査し `firebase/auth` / `$lib/firebase` / `authStore` / `currentUser` の混入を禁じている。**要件 10-3 はこの検査の対象文字列の更新を含む**（`AuthGate` / `svelte-firebase-auth` を追加すべきか）。
- `src/tests/utils/redirect.test.ts` は削除対象。
- モジュール側の `AuthGate` は「**単体では試験しない**（ルーター無しでは `goto` が例外を投げる）」と design に明記されており、E2E で確かめる方針。logotope に Playwright の E2E は現状 1 本も無い（`playwright` は devDependency にあるが `test:e2e` スクリプトが無い）。

## 2. Requirement → 資産マップ

| 要件 | 既存資産 | gap | 備考 |
|---|---|---|---|
| 1-1〜1-5 撤去 | `auth.svelte.ts` / `redirect.ts` / ログインフォーム | **Constraint** | 参照 7 spec の同時更新が要る |
| 1-6 未公開の解決 | なし | **Missing（ブロッカー）** | → 論点 1 |
| 1-7 版の引き上げ | `package.json` / `pnpm-workspace.yaml` | **Constraint** | kit / firebase / svelte-ui の3つ＋除外列挙 |
| 1-8 二重バンドル | `vite.config.ts`（設定なし） | **Unknown** | svelte-ui が現に動く理由の確認が要る |
| 2-1〜2-3 生成と寿命 | `admin/+layout.svelte`（`topicsStore` の寿命の前例あり） | Low | context は新規パターン |
| 2-4〜2-6 `continueUrl` | `.env` / `apphosting.yaml` | **Missing** | 環境別の URL 変数を新設 |
| 2-7 `isResolved` | `authStore.loading` | Low | 意味の反転に注意 |
| 3-1〜3-5 経路 | `admin/login/` のみ | **Missing** | `passwordReset` / `verifyEmail` の経路が無い。`afterSignIn` は `/admin/topics`（→ 事実 5） |
| 3-6〜3-9 画面 | ログインフォーム | Low | `header` に `AdminTemplate` の名乗りを移す |
| 4-1〜4-2 配置 | `admin/+layout.svelte` | **Constraint（要注意）** | → 論点 2。モジュールの想定と食い違う |
| 4-3〜4-4 `pending` | `AdminTemplate` の `{#if authStore.user}` | Low | 出し分けを `AuthGate` へ移す |
| 4-7 分岐を置かない | `admin/+layout.svelte` の `$effect` 2本 | Low | 認証の側のみ撤去。`topicsStore` の側は残す |
| 4-8 `ssr = false` | `admin/+layout.ts` | なし | 維持のみ |
| 5-1〜5-6 戻り先 | `?redirect=` ＋ `sanitizeAdminRedirect` | **Constraint** | 方式が変わる（sessionStorage） |
| 6-1〜6-4 サインアウト | `AdminTemplate` | Low | `logout()` → `signOut()` |
| 7-1〜7-4 登録の抑止 | なし | Low | 設定値＋Firebase コンソールの運用 |
| 8-1〜8-5 確認を求めない | なし | Low | `emailVerification: false`。ただし `verifyEmail` 経路の型は必須（→ 論点 5） |
| 9-1〜9-2 再設定 | なし | **Missing** | 経路と画面の新設 |
| 9-3〜9-4 変更 | なし | **Missing** | 置き場所が未定（→ 論点 4） |
| 10-1〜10-2 防御 | `firestore.rules` / `requireAuth` | なし | 変更しないことの確認 |
| 10-3 公開面の検査 | `article-list-public-behavior.test.ts` | **Constraint** | 検査対象文字列の更新 |
| 10-4 既存 spec | 7 本 | **Constraint** | → 論点 3 |
| 10-5 エミュレータ | `VITE_USE_EMULATOR` | Low | Auth エミュレータは既に接続済み |

## 3. 実装アプローチ

### 論点 1: 依存の取り込み方（ブロッカー）

モジュールは npm 未公開で、実体は **logotope のリポジトリの外**（`~/workspace/SvelteFirebaseAuth/`）にある。Firebase App Hosting はリポジトリの内容からビルドするため、**リポジトリ外への参照はデプロイのビルドで解決できない**。

- **Option A: npm へ公開する（`@14ch/svelte-firebase-auth`）**
  - ✅ `@14ch/svelte-ui` と同じ扱いになり、既存の運用に乗る。App Hosting のビルドが通る
  - ✅ 版が固定でき、モジュール側の変更が logotope へ勝手に流れ込まない
  - ❌ 差し替えの作業中にモジュール側の修正が要ると、その都度 publish が要る
  - ❌ `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` に新しい版を追加し続ける運用が要る
- **Option B: GitHub の git 依存として参照する**
  - ✅ publish を挟まずに版を固定できる（コミットハッシュ指定）
  - ❌ **リポジトリが GitHub に存在しない**。作成が前提になる
  - ❌ **`dist/` は `.gitignore` されており git に含まれない**（確認済み）。git 依存にするなら `prepare` でのビルドが要り、組み込み側のインストールが重くなる
- **Option C: pnpm の `link:` / `file:` でローカル参照**
  - ✅ 開発中の往復が最も速い。モジュール側の修正が即座に反映される
  - ❌ **App Hosting のデプロイで壊れる。**リポジトリ外の絶対パスは CI/ビルド環境に存在しない
  - ❌ `pnpm-lock.yaml` にローカルパスが記録され、他の環境で再現しない

**評価**: 開発中は C、確定後に A、という二段構えが現実的。ただし「差し替えが完了した」と言える状態は A（または B）に到達したときであり、**C のままではデプロイできない**。この決定は他のすべての作業に先行する。

### 論点 2: `AuthGate` の配置

モジュールは「根の `+layout.svelte` に1つ」を前提に設計されている（依存元 spec の要件 1-4）。logotope は公開ページを持つため、そのままでは成立しない。

- **Option A: `/admin/+layout.svelte` に置く（推奨）**
  - ✅ 公開ページが `AuthGate` の外に残り、要件 4-2 が自然に満たされる
  - ✅ `/admin` 配下は既に `ssr = false` であり、ブラウザでのみ働くという `AuthGate` の性質と合う
  - ✅ 認証の4経路をすべて `/admin` 配下に置けば、`resolveAuthGuard` の判定は設計どおり働く（`currentPath` と `routes` の突き合わせは相対パスの完全一致であり、部分木でも成立する）
  - ❌ モジュールの想定（根に1つ）から外れる。**モジュール側の spec・README にこの組み込み方が書かれていないため、後続の変更で前提が崩れうる**
  - ❌ 公開ページから `/admin/**` へ遷移したとき、`AuthGate` のマウントと同時に判定が走る経路を確認する必要がある
- **Option B: 根に置き、`routes` を公開ページも含む形にする**
  - ❌ **成立しない。** `resolveAuthGuard` は `signed-out` で認証4経路以外を全て振り替える。公開ページを「認証の経路」に含めることはできない
- **Option C: ルートグループ（`(public)` / `(admin)`）で分ける**
  - ✅ 保護対象と公開の境界がディレクトリ構造として明示される
  - ❌ 既存の全 URL に影響する大がかりな変更で、本 spec の範囲を超える
  - ❌ URL は変わらないが、`+layout` の階層が変わり公開ページの SSR 設定にも波及する

**評価**: A が唯一現実的。ただし「モジュールの想定外の使い方をしている」ことを logotope 側の design に記録し、**モジュール側へ「部分木への配置」を返す事項として渡す**のが筋（→ 申し送り）。

### 論点 3: 認証ストアの共有と、既存 7 spec の扱い

モジュールのストアは `createAuthStore()` で生成するインスタンスであり、`setContext` で配る前提。一方 logotope の既存コンポーネントは `import { authStore } from '$lib/stores/auth.svelte'` でモジュールレベルのシングルトンを直読みし、spec は `vi.mock('$lib/stores/auth.svelte.js', ...)` でそれを差し替えている。**コンポーネントを `getContext` に書き換えると、単体で描画する spec では context が空になり 7 本が壊れる。**

- **Option A: logotope 側に薄いアクセサを1つ置く（推奨）**
  - 例: `src/lib/stores/adminAuth.svelte.ts` が `setAdminAuthStore(store)` / `getAdminAuthStore()` を持ち、内部で `setContext` / `getContext` を呼ぶ
  - ✅ コンポーネントの読み方が現状と同じ「1つの import」で済み、`.kiro/steering/conventions.md` の「表示コンポーネントは store 直読みを好む」に沿う
  - ✅ spec は `vi.mock('$lib/stores/adminAuth.svelte.js', ...)` へ差し替えるだけで、既存の 7 本の構造を保てる
  - ❌ モジュールの `AuthStore` の上に logotope 独自の層が1枚増える。**要件 1-1「同等の実装を持たない」との境界を design で明示する必要がある**（この層は状態も操作も持たず、受け渡しだけを行う）
- **Option B: `store` を props で流す**
  - ✅ 追加の層が要らず、依存が明示的
  - ❌ `AdminTemplate` → 各ページと prop ドリリングが発生する。conventions.md が明示的に避けている形
  - ❌ 7 本の spec すべてで props の追加が要る
- **Option C: logotope 側でモジュールレベルのシングルトンとして生成する**
  - ✅ 既存のストアと完全に同じ形。spec の変更が最小
  - ❌ `start()` / `stop()` の寿命を階層に束ねられず、要件 2-3 と衝突する
  - ❌ import しただけで `createAuthStore` が走り、公開ページのバンドルへ混入しうる（要件 10-3 に抵触）

**評価**: A。B は規約に反し、C は要件 2-3 / 10-3 と衝突する。

### 論点 4: `PasswordChange` の置き場所

管理画面にアカウント設定に相当する画面が無い（`/admin` 自体が 404）。要件 9-3 / 9-4 は「認証の経路に含めない場所」を求める。

- **Option A: `/admin/account` を新設し、`PasswordChange` を置く** — 最も素直。`AdminTemplate` のヘッダーから導線を引く
- **Option B: `AdminTemplate` 内のダイアログとして開く** — 経路を増やさないが、`PasswordChange` は完了時に `goto(store.routes.afterSignIn)` を行うため、ダイアログの中で遷移が起きて挙動が噛み合わない
- **Option C: 当面置かない（要件 9-3 を落とす）** — 再設定（要件 9-1）だけでも復旧経路は成立する

**評価**: A。B はモジュールの実装（`goto` する）と相性が悪いことをコードで確認済み。

### 論点 5: `emailVerification: false` の下での `verifyEmail` 経路

`AuthRoutes.verifyEmail` は型として必須だが、`emailVerification: false` では `email-unverified` の段階が生じないため到達しない。

- **Option A: `/admin/verify-email` を用意し `VerifyEmail` を置く** — 到達しないが、後で `true` へ切り替えるときに何も足さずに済む。`ready` の利用者が直接開いても `isAuthRoute` として `afterSignIn` へ振り替えられる
- **Option B: 経路の値だけ与え、画面を置かない** — 直接 URL を開くと SvelteKit の 404 になる。`AuthGate` の振り替えと 404 の描画のどちらが先かは要確認（→ Research）
- **Option C: `verifyEmail` に `signIn` と同じ値を与える** — 型を満たし、到達しても破綻しない。ただし**設定を読んだ人が意図を誤解する**

**評価**: A。使わない画面を1つ置くコストは小さく、B は挙動が未確定、C は読み手を欺く。

## 4. Effort & Risk

| 項目 | 評価 | 理由 |
|---|---|---|
| Effort | **M〜L（5〜10日）** | 差し替えそのものは M。ただし依存の取り込み（論点 1）・版の引き上げ3件・spec 7 本の更新・新規経路3つが積み上がる |
| Risk | **Medium〜High** | 高い側の要因は3つ: ①モジュールが npm 未公開でデプロイ経路が未確立、②`AuthGate` をモジュールの想定外の位置に置く、③`AuthGate` は単体試験ができず、logotope に E2E の土台が無い |

内訳:

- 依存の取り込み（論点 1）— **Risk: High**。決まるまで他が確定しない
- `AuthGate` の配置（論点 2）— **Risk: Medium**。設計は成立するが、モジュール側の想定外
- 版の引き上げ（kit / firebase / svelte-ui）— **Risk: Medium**。kit 2.56 → 2.63 と svelte-ui 0.0.58 → 0.0.61 の間の変更点が未確認
- ストアの共有とテスト（論点 3）— **Risk: Low**。方式が決まれば機械的
- 経路と画面の新設 — **Risk: Low**
- 撤去（`authStore` / `redirect.ts` / ログインフォーム）— **Risk: Low**

## 5. 設計フェーズへの申し送り

### 推奨する方針

1. **依存は「開発中は `link:`、確定後に npm 公開」の二段構え**とし、design に publish を完了の条件として位置づける（論点 1）
2. **`AuthGate` は `/admin/+layout.svelte` に置く**（論点 2 Option A）。モジュールの想定（根に1つ）から外れることを design に記録する
3. **`src/lib/stores/adminAuth.svelte.ts` を1つ置き、`setContext` / `getContext` を包む**（論点 3 Option A）。この層が状態も操作も持たないことを明記する
4. **`afterSignIn` は `/admin/topics`**（`/admin` は存在しない）。ついでに `/admin` の 404 を塞ぐかは別途判断
5. **`/admin/account` に `PasswordChange`、`/admin/verify-email` に `VerifyEmail`** を置く（論点 4-A / 5-A）

### モジュール側へ返すべき事項

- **`AuthGate` を部分木（保護したい階層）に置く組み込み方が、README にも spec にも無い。** logotope はこの形を採る。モジュール側で想定として認めるか、根への配置を前提とし続けるかの判断が要る
- `PasswordChange` が完了時に `goto(routes.afterSignIn)` を行うため、**ダイアログとして組み込めない**。意図どおりか

### Research Needed（design フェーズで確定させる）

1. **Vite の設定**: `@14ch/svelte-ui` が `optimizeDeps.exclude` 無しで動いている理由を確定し、`@14ch/svelte-firebase-auth` にも同じことが言えるか。README の `include` 列挙（dayjs / dompurify）を足したとき、logotope の既存の依存（`dayjs` / `isomorphic-dompurify`）に影響しないか
2. **版の引き上げ**: `@sveltejs/kit` 2.56 → 2.63、`@14ch/svelte-ui` 0.0.58 → 0.0.61、`firebase` 12.14 → 12.18 の間に破壊的変更が無いか。`pnpm-workspace.yaml` の `minimumReleaseAgeExclude` の更新方法
3. **`continueUrl` の供給**: 環境別（開発 / 本番）の URL をどの変数で渡すか。`apphosting.yaml` に BUILD 変数を追加する形か
4. **Firebase の承認済みドメイン**: App Hosting のドメインが承認済みドメインに入っているか（再設定メールの送信に要る）
5. **`AuthGate` の検証手段**: 単体試験ができない以上、E2E を新設するか、`resolveAuthGuard` の判定をモジュール側の試験に委ねて logotope では手動確認に留めるか
6. **公開面の検査の更新**: `article-list-public-behavior.test.ts` の禁止パターンに `svelte-firebase-auth` / `AuthGate` を加えるか
7. **`/admin` の 404**: `afterSignIn` を `/admin/topics` にすれば実害は消えるが、`/admin` を直接開いた場合の扱いを決めるか（本 spec の範囲に含めるかを含めて）
