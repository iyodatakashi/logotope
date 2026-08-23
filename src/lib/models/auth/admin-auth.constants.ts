import type { AuthConfig } from '@14ch/svelte-firebase-auth';

const SIGN_IN_ROUTE = '/admin/login';

/**
 * 管理画面の自前登録を許すか。**コード側のスイッチはこの環境変数1つだけ。**
 * 画面の入口・経路の値・経路の到達可否は、すべてここから導く。
 * ビルド時に埋め込まれるため、実行時の分岐にはならない。
 *
 * これは防御ではなく体験の設定である。登録 API そのものは Firebase コンソールの
 * User actions でしか塞げない（→ .kiro/steering/firebase.md）。
 */
export const SELF_REGISTRATION = import.meta.env.VITE_SELF_REGISTRATION === 'true';

// 管理画面の認証の確定値。実行時に切り替える余地を作らない。
// 経路は URL に現れるとおりの pathname を書く（判定は問い合わせ文字列を無視した完全一致）
export const ADMIN_AUTH_CONFIG: AuthConfig = {
	selfRegistration: SELF_REGISTRATION,
	emailVerification: false,
	// 再設定を終えた管理者の着地先。公開の根へ落とすと記事一覧へ放り出される
	continueUrl: `${import.meta.env.VITE_APP_ORIGIN}${SIGN_IN_ROUTE}`,
	routes: {
		signIn: SIGN_IN_ROUTE,
		// 許さないときはサインインを重ね、モジュールに登録への導線を作らせない
		signUp: SELF_REGISTRATION ? '/admin/signup' : SIGN_IN_ROUTE,
		verifyEmail: '/admin/verify-email',
		passwordReset: '/admin/password-reset',
		afterSignIn: '/admin/topics'
	}
};
