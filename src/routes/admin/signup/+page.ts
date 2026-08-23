import { redirect } from '@sveltejs/kit';
import { ADMIN_AUTH_CONFIG, SELF_REGISTRATION } from '$lib/models/auth/admin-auth.constants';

// 経路は常に実在させ、到達可否はスイッチから導く。
// モジュールの SignUp は設定を見ずに描画するため、ここで塞がないと URL 直打ちで届く
export const load = () => {
	if (!SELF_REGISTRATION) {
		redirect(307, ADMIN_AUTH_CONFIG.routes.signIn);
	}
};
