# Requirements Document

## Project Description (Input)
管理画面の認証を /svelte-firebase-auth モジュールに差し替えたい

## Introduction

logotope の管理画面（`/admin/**`）は、Firebase Auth のメール／パスワード認証を自前で実装している。認証ストア（`src/lib/stores/auth.svelte.ts`）・ログインフォーム（`src/routes/admin/login/+page.svelte`）・到達ガード（`src/routes/admin/+layout.svelte`）・復帰先の検証（`src/lib/utils/redirect.ts`）がそれぞれ個別に書かれており、提供する機能はサインインとサインアウトだけである。パスワードを忘れた管理者は自力で復旧できない。

別リポジトリで開発済みの `@14ch/svelte-firebase-auth`（`~/workspace/SvelteFirebaseAuth/svelte-firebase-auth`）は、認証ストア・5つの画面（サインイン・登録・確認待ち・パスワードの変更・パスワードの再設定）・**到達の制御**を提供する SvelteKit のライブラリである。組み込み側に残るのは Firebase の初期化・経路の設定・アクセス制御だけになる。本 spec は、管理画面の認証をこのモジュールへ差し替え、自前実装を撤去する。差し替えの結果としてパスワードの再設定と変更が管理画面に加わる。

差し替えは置き換えにとどまらず、いくつかの担当の移動と意味の変更を伴う。

- **到達ガードと遷移がライブラリへ移る。** 認証の段階（`AuthStage`）に応じた振り替えは `AuthGate` が行う。logotope 側にガードの分岐は残らない。
- **サインイン後の戻り先の保持もライブラリへ移る。** 現行の `?redirect=` クエリと `sanitizeAdminRedirect` に代わり、ライブラリがタブ単位（`sessionStorage`）で保持し、外部を指す値を排除する。
- **画面はコールバックを受け取らない。** 5つの画面は `store` / `messages` / `header` だけを受け取り、画面どうしの行き来は `AuthConfig.routes` を見てライブラリが行う。
- **判定の意味が変わる。** 現行の `loading`（初期 true）はモジュールの `isResolved`（一度 true になったら戻らない）へ、例外を投げる `login()` は `AuthResult` を返す `signIn()` へ変わる。

## Boundary Context

- **In scope**: 管理画面の認証（サインイン・サインアウト・到達の制御・戻り先・パスワードの再設定と変更）を `@14ch/svelte-firebase-auth` へ委譲すること。自前の認証ストア・ログインフォーム・到達ガード・復帰先の検証の撤去。認証の経路（`AuthRoutes`）に対応する画面の配置。
- **Out of scope**: `@14ch/svelte-firebase-auth` 自体の実装・仕様変更（別リポジトリの担当）。外部の認証プロバイダ（Google / Apple 等）の追加。管理者以外の一般利用者向けアカウント機能。公開ページ（`/`・`/articles/**`）の表示内容。Firebase Functions 側の認証検証（`functions/src/utils/auth.ts`）の方式変更。Firestore のセキュリティルールの条件の変更。
- **Adjacent expectations**:
  - モジュールは **SvelteKit を前提とする**。遷移に `$app/navigation` の `goto`、現在の経路に `$app/state` の `page` を使う。
  - モジュールは **Firebase の初期化・経路の実体（`+page.svelte`）・Firestore とアクセス制御・サーバ側のセッション検証を担当しない**。これらは logotope 側に残る。
  - モジュールは `Auth` インスタンスを外から受け取る。logotope の `src/lib/firebase.ts` が初期化したものを渡す。
  - モジュールの peer 依存は `firebase ^12.18.0` / `@sveltejs/kit ^2.63.0` / `@14ch/svelte-ui ^0.0.61` / `svelte ^5.0.0`。logotope の現行は `firebase ^12.14.0` / `@14ch/svelte-ui ^0.0.58` であり、引き上げが要る。
  - モジュールは npm へ未公開である。logotope が依存として解決できる形にすることは、本 spec の達成条件に含まれる。
  - モジュールは `.svelte` のまま配布されるため、組み込み側の Vite に `optimizeDeps.exclude` と `resolve.dedupe` の設定が要る（README に明記）。
  - **`AuthGate` は体験のための仕組みであって防御ではない。** ブラウザでのみ働き、包み忘れれば働かない。到達の制御があることを理由に Firestore のセキュリティルールを緩めない（README に明記）。
  - モジュールの `resolveAuthGuard` は、`signed-out` の段階において**認証の4経路以外のすべてをサインインへ振り替える**。logotope は公開ページを持つため、`AuthGate` の適用範囲は保護したい階層に限る必要がある。

## Requirements

### Requirement 1: 認証実装のモジュールへの委譲と自前実装の撤去

**Objective:** 開発者として、認証の実装を1か所（モジュール）に集約したい。そうすれば logotope 側に認証ロジックの重複が残らず、モジュールの改善がそのまま管理画面に反映される。

#### Acceptance Criteria

1. The 管理画面 shall 認証状態の保持・Firebase Auth への操作・到達の制御・戻り先の保持を `@14ch/svelte-firebase-auth` に委譲し、logotope 側に同等の実装を持たない。
2. The 管理画面 shall `src/lib/stores/auth.svelte.ts`（自前の `authStore`）を削除し、これを参照する箇所をモジュールのストアの参照へ置き換える。
3. The 管理画面 shall `src/lib/utils/redirect.ts`（`sanitizeAdminRedirect`）と対応するテストを、同じ役割をモジュールが担うため削除する。
4. The 管理画面 shall `firebase/auth` の認証操作 API（`signInWithEmailAndPassword` / `signOut` / `onAuthStateChanged` 等）を直接呼ばない。`src/lib/firebase.ts` による `Auth` の初期化は logotope 側に残す。
5. The 管理画面 shall 現行の `authStore.getIdToken()` を、参照が存在しないため移行先を設けずに廃止する。
6. When logotope が `@14ch/svelte-firebase-auth` を依存として解決するとき, the ビルドと開発サーバー shall モジュールが npm へ未公開であることに妨げられず、管理画面を描画できる。
7. The 管理画面 shall モジュールの peer 依存を満たすバージョン（`firebase ^12.18.0` 以上・`@sveltejs/kit ^2.63.0` 以上・`@14ch/svelte-ui ^0.0.61` 以上・`svelte ^5.0.0` 以上）を使用する。
8. If モジュールが二重にバンドルされる設定であるならば, the ビルド設定 shall モジュールと `@14ch/svelte-ui` を事前バンドルから除外し、`svelte` の実体を1つに揃える。

### Requirement 2: 認証ストアの生成・設定・寿命

**Objective:** 管理者として、管理画面のどの画面でも同一の認証状態が見えてほしい。そうすればページ遷移のたびに認証状態が作り直されたり、判定が終わる前に未サインインと誤って扱われたりしない。

#### Acceptance Criteria

1. The 管理画面 shall `createAuthStore(auth, config)` で認証ストアを1つ生成し、`/admin` 配下の全画面から同一のインスタンスを参照できるようにする。
2. The 管理画面 shall 認証ストアの生成と共有を `/admin` の階層に置き、公開ページ（`/admin` の外）ではストアを生成しない。
3. When 認証ストアが利用可能になったとき, the 管理画面 shall `start()` を呼び、対応する後始末として `stop()` を呼ぶ。
4. The 管理画面 shall モジュールへ渡す `AuthConfig` の全項目（`selfRegistration` / `emailVerification` / `continueUrl` / `routes`）を、実行時の分岐を要さない確定した値として与える。
5. The 管理画面 shall `continueUrl` を、実行環境に対応する管理画面の URL として与える。
6. If `continueUrl` のドメインが Firebase の承認済みドメインに含まれていないならば, the 管理画面 shall 再設定メールの送信が失敗することを利用者へ案内し、失敗を無言で握りつぶさない。
7. The 管理画面 shall 現行の `loading`（初期 true・判定完了で false）に代えてモジュールの `isResolved`（判定完了で true・以後戻らない）を用い、判定の完了前を「未サインイン」として扱わない。

### Requirement 3: 認証の経路と画面の配置

**Objective:** 管理者として、サインインやパスワードの再設定がそれぞれ固有の URL を持ってほしい。そうすればブックマークや再読み込みで画面が失われず、ライブラリの遷移も期待どおりに働く。

#### Acceptance Criteria

1. The 管理画面 shall `AuthRoutes` の全項目（`signIn` / `signUp` / `verifyEmail` / `passwordReset` / `afterSignIn`）に、logotope の実在する経路を与える。
2. The 管理画面 shall 認証の経路を `/admin` 配下に置き、`AuthGate` の適用範囲の中に含める。
3. The 管理画面 shall 各経路の `+page.svelte` を、対応する画面コンポーネントを1つ差し込む最小のラッパーとする（`.kiro/steering/structure.md` の routes の規約に従う）。
4. The 管理画面 shall 経路の値を、URL に現れるとおりの `pathname` として与える（一致の判定は問い合わせ文字列を無視した完全一致である）。
5. The 管理画面 shall `afterSignIn` を、認証を終えた管理者の既定の行き先となる管理画面の経路として与える。
6. The 管理画面 shall サインインの画面としてモジュールの `SignIn` を用い、自前のログインフォームのマークアップを撤去する。
7. The 管理画面 shall 画面へコールバックを渡さず、画面どうしの行き来をモジュールに委ねる。
8. The 管理画面 shall モジュールの既定の日本語の文言を用い、logotope 固有の語（画面上の呼称など）に限って項目単位で差し替える。
9. The 管理画面 shall 各画面の `header` に logotope の名乗りを差し込む。

### Requirement 4: 到達の制御

**Objective:** 管理者として、未サインインで管理画面の URL を開いたらサインインへ誘導されてほしい。そして閲覧者として、公開ページはサインインなしで読めてほしい。

#### Acceptance Criteria

1. The 管理画面 shall `AuthGate` を `/admin` の階層に1つ置き、配下の画面をこれで包む。
2. The 公開ページ shall `AuthGate` の適用範囲の外に置かれ、認証の段階によらず到達を妨げられない。
3. While 認証状態の判定が完了していない間, the 管理画面 shall 配下の画面の内容を描画せず、遷移も行わない。
4. While 認証状態の判定が完了していない間, the 管理画面 shall `AuthGate` の `pending` として読み込み中であることを示すものを描画する。
5. When 認証状態の判定が完了し、利用者がサインインしていないとき, the 管理画面 shall 認証の経路を除く `/admin` 配下の到達をサインインへ振り替える。
6. When サインイン済みの利用者が認証の経路を開いたとき, the 管理画面 shall 戻り先または `afterSignIn` へ振り替え、認証の画面に留めない。
7. The 管理画面 shall 到達の制御を `AuthGate` だけに持たせ、logotope 側に段階を見た分岐や遷移のコードを置かない。
8. The 管理画面 shall `/admin` 配下をクライアントサイドで動作させる現行の設定（`src/routes/admin/+layout.ts` の `ssr = false`）を維持する。

### Requirement 5: サインイン後の戻り先

**Objective:** 管理者として、作業中のページの URL を直接開いたとき、サインインを終えたらそのページへ戻りたい。そうすれば毎回一覧から辿り直さずに作業を再開できる。

#### Acceptance Criteria

1. When 未サインインの利用者が保護された経路を開いたとき, the 管理画面 shall その経路を戻り先として保持したうえでサインインへ振り替える。
2. When 認証の条件を満たしたとき, the 管理画面 shall 保持していた戻り先へ進み、これを破棄する。
3. The 管理画面 shall 戻り先の保持をモジュールに委ね、`?redirect=` クエリによる受け渡しを行わない。
4. If 戻り先が外部を指す値であるならば, the 管理画面 shall これを用いず `afterSignIn` へ進む。
5. The 管理画面 shall 認証の経路そのものを戻り先にしない。
6. The 管理画面 shall 振り替えを履歴に残さず、戻る操作で振り替え前の経路へ戻らないようにする。

### Requirement 6: サインアウト

**Objective:** 管理者として、管理画面の共通ヘッダーからサインアウトしたい。そうすれば共有端末で作業を終えるときに認証状態を確実に切れる。

#### Acceptance Criteria

1. While 利用者がサインインしている間, the 管理画面 shall 共通ヘッダーにサインアウトの操作を表示する。
2. When 管理者がサインアウトを実行したとき, the 管理画面 shall モジュールの `signOut()` を呼ぶ。
3. When サインアウトが完了したとき, the 管理画面 shall `AuthGate` の振り替えによってサインインへ遷移し、管理画面の内容を描画しない。
4. When サインアウトが完了したとき, the 管理画面 shall 認証に依存して購読していた Firestore の購読（`topicsStore` 等）を停止する。

### Requirement 7: 自由登録の抑止

**Objective:** 運営者として、管理画面のアカウントを自分たちの管理下に置きたい。そうすれば管理画面の URL を知った第三者が勝手にアカウントを作って侵入することがない。

#### Acceptance Criteria

1. The 管理画面 shall `AuthConfig.selfRegistration` を `false` として、登録の入口を画面に出さない。
2. The 管理画面 shall 登録の API 自体を Firebase コンソールの設定で塞ぎ、画面の出し分けだけを防御としない。
3. If 登録が Firebase 側で塞がれている状態で登録が試みられたならば, the 管理画面 shall `registration-disabled` に対応する案内を表示する。
4. The 管理画面 shall 管理者アカウントの作成を、運営者による Firebase コンソールでの操作として運用する。

### Requirement 8: メールアドレスの確認を求めない

**Objective:** 運営者として、管理者アカウントを自分で作る運用のもとで、確認の段階を挟まずに管理画面へ入れるようにしたい。そうすれば既存アカウントの移行とアクセス制御の条件追加という、実利の伴わない作業を避けられる。

#### Acceptance Criteria

1. The 管理画面 shall `AuthConfig.emailVerification` を `false` として、メールアドレスの確認を求めない。
2. While `emailVerification` が `false` である間, the 管理画面 shall `email-unverified` の段階を生じさせず、確認待ちへの振り替えを行わない。
3. The 管理画面 shall 既存の管理者アカウントに対して、確認の状態を理由とする移行作業を要さない。
4. The Firestore のセキュリティルール shall 管理者としての読み書きの条件を現行のまま（サインイン済みであること）とし、メールアドレスの確認を条件に加えない。
5. The 管理画面 shall メールアドレスの到達性の確認を、運営者がアカウントを作成する時点の運用で担保する。

### Requirement 9: パスワードの再設定と変更

**Objective:** 管理者として、パスワードを忘れても自力で復旧し、必要なときに変更したい。そうすれば運営者の手作業による復旧を待たずに作業へ戻れる。

#### Acceptance Criteria

1. The 管理画面 shall パスワード再設定の画面（`PasswordReset`）を `AuthRoutes.passwordReset` の経路に置き、サインインの画面から到達できるようにする。
2. When 再設定の要求が受け付けられたとき, the 管理画面 shall 要求が送られた旨を表示し、そのメールアドレスが登録済みかどうかを区別して示さない。
3. While 利用者がサインインしている間, the 管理画面 shall パスワードの変更（`PasswordChange`）へ到達できる導線を管理画面内に置く。
4. The 管理画面 shall パスワードの変更の経路を認証の経路に含めず、`AuthGate` の振り替えの対象にならない場所へ置く。
5. If 現在のパスワードによる再認証に失敗したならば, the 管理画面 shall モジュールが返す案内を表示し、パスワードの変更を行わない。
6. If 認証の操作が失敗したならば, the 管理画面 shall モジュールが返す `AuthError` に対応する案内を表示し、例外として扱わない。

### Requirement 10: アクセス制御と既存の不変条件の維持

**Objective:** 開発者として、認証の差し替えが防御の水準を下げず、管理画面以外へ波及しないことを確かめたい。そうすれば到達の制御をライブラリへ渡したことが、そのまま穴にならない。

#### Acceptance Criteria

1. The Firestore のセキュリティルール shall 到達の制御がライブラリへ移ったことを理由に緩められない。
2. The Firebase Functions shall 呼び出し元の認証の検証（`functions/src/utils/auth.ts` の `requireAuth`）を現行のまま維持する。
3. The 公開ページ shall 認証のコード（`firebase/auth`・認証ストア・モジュールの画面・`AuthGate`）を読み込まない。既存の検査（`src/tests/features/public/article-list/article-list-public-behavior.test.ts`）がこれを守り続ける。
4. The 管理画面の既存のテスト shall 自前の `authStore` のモックに代えてモジュールのストアを差し替える形へ更新され、削除されずに通る。
5. The 管理画面 shall Firebase エミュレータへ接続する開発時の構成（`VITE_USE_EMULATOR`）のもとで、サインインからサインアウトまで動作する。
6. The 管理画面 shall 差し替えの前後で、認証に依存する既存の画面（トピック一覧・トピック詳細の各フェーズ）の到達性を変えない。
