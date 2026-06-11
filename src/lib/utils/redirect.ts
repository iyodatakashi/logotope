// ログイン後復帰先の検証（オープンリダイレクト防止）。
// /admin 配下の相対パスのみ許可し、それ以外はダッシュボードへフォールバックする。
export const sanitizeAdminRedirect = (value: string | null): string => {
	if (!value) return '/admin';
	if (value === '/admin/login' || value.startsWith('/admin/login?')) return '/admin';
	if (value === '/admin' || value.startsWith('/admin/') || value.startsWith('/admin?')) {
		return value;
	}
	return '/admin';
};
