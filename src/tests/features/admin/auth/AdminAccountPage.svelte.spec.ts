import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { ADMIN_AUTH_CONFIG } from '$lib/models/auth/admin-auth.constants';

const { goto, changePassword, store } = vi.hoisted(() => {
	const goto = vi.fn();
	const changePassword = vi.fn();
	const routes = {
		signIn: '/admin/login',
		signUp: '/admin/login',
		verifyEmail: '/admin/verify-email',
		passwordReset: '/admin/password-reset',
		afterSignIn: '/admin/topics'
	};
	return { goto, changePassword, store: { routes, changePassword } };
});

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/stores/adminAuth.svelte.js', () => ({ getAdminAuthStore: () => store }));

import AdminAccountPage from '$lib/features/admin/auth/AdminAccountPage.svelte';

const submit = async (current: string, next: string) => {
	await page.getByLabelText('現在のパスワード').fill(current);
	await page.getByLabelText('新しいパスワード').fill(next);
	await page.getByRole('button', { name: '変更する' }).click();
};

describe('AdminAccountPage.svelte', () => {
	it('検査に使う経路が実際の設定と一致している', () => {
		expect(store.routes.afterSignIn).toBe(ADMIN_AUTH_CONFIG.routes.afterSignIn);
	});

	it('変更に成功すると既定の行き先へ戻る', async () => {
		goto.mockClear();
		changePassword.mockResolvedValueOnce({ ok: true });
		render(AdminAccountPage);

		await submit('current-pass', 'next-pass-1');

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith(ADMIN_AUTH_CONFIG.routes.afterSignIn));
	});

	it('再認証に失敗したときは遷移せず、案内を表示する', async () => {
		goto.mockClear();
		changePassword.mockResolvedValueOnce({
			ok: false,
			error: { kind: 'invalid-credential', detail: '', unmetPasswordRequirements: [] }
		});
		render(AdminAccountPage);

		await submit('wrong-pass', 'next-pass-1');

		await expect.element(page.getByRole('alert')).toBeInTheDocument();
		expect(goto).not.toHaveBeenCalled();
	});
});
