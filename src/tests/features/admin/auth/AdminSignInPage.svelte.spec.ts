import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { ADMIN_AUTH_CONFIG } from '$lib/models/auth/admin-auth.constants';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const store = {
	canSelfRegister: false,
	routes: ADMIN_AUTH_CONFIG.routes,
	signIn: vi.fn()
};
vi.mock('$lib/stores/adminAuth.svelte.js', () => ({ getAdminAuthStore: () => store }));

import AdminSignInPage from '$lib/features/admin/auth/AdminSignInPage.svelte';

describe('AdminSignInPage.svelte', () => {
	it('logotope の名乗りを上部に出す', async () => {
		store.canSelfRegister = false;
		render(AdminSignInPage);

		await expect.element(page.getByRole('heading', { name: 'logotope' })).toBeInTheDocument();
	});

	it('自前登録を許すときだけ登録への導線を出す', async () => {
		store.canSelfRegister = true;
		render(AdminSignInPage);

		await expect
			.element(page.getByRole('button', { name: 'アカウントを作成する' }))
			.toBeInTheDocument();
	});

	it('自前登録を許さないときは登録への導線を出さない', async () => {
		store.canSelfRegister = false;
		render(AdminSignInPage);

		await expect.element(page.getByRole('button', { name: 'サインイン' })).toBeInTheDocument();
		expect(page.getByRole('button', { name: 'アカウントを作成する' }).elements()).toHaveLength(0);
	});
});
