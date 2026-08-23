import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto }));

const signOut = vi.fn();
const store = { signOut, isLoggedIn: true };
vi.mock('$lib/stores/adminAuth.svelte.js', () => ({ getAdminAuthStore: () => store }));

import AdminTemplate from '$lib/features/admin/AdminTemplate.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>管理画面の中身</p>' }));

describe('AdminTemplate.svelte', () => {
	it('サインインしている間だけサインアウトの操作を表示する', async () => {
		store.isLoggedIn = true;
		render(AdminTemplate, { props: { children } });

		await expect.element(page.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument();
	});

	it('サインインしていなければサインアウトの操作を表示しない', () => {
		store.isLoggedIn = false;
		render(AdminTemplate, { props: { children } });

		expect(page.getByRole('button', { name: 'ログアウト' }).elements()).toHaveLength(0);
	});

	it('サインアウトはモジュールの操作を呼び、遷移を行わない', async () => {
		store.isLoggedIn = true;
		render(AdminTemplate, { props: { children } });

		await page.getByRole('button', { name: 'ログアウト' }).click();

		expect(signOut).toHaveBeenCalledOnce();
		expect(goto).not.toHaveBeenCalled();
	});
});
