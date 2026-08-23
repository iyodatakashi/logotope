import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { AuthStore } from '@14ch/svelte-firebase-auth';
import AdminAuthProvider from './fixtures/AdminAuthProvider.svelte';
import AdminAuthConsumer from './fixtures/AdminAuthConsumer.svelte';

const makeStore = () => ({ isLoggedIn: true }) as unknown as AuthStore;

describe('adminAuth 受け渡し層', () => {
	it('登録したインスタンスが配下でそのまま取得できる', () => {
		const store = makeStore();
		const onresolve = vi.fn();

		render(AdminAuthProvider, { props: { store, onresolve } });

		expect(onresolve).toHaveBeenCalledWith(store);
	});

	it('登録していない階層で取得すると例外を投げる', () => {
		expect(() => render(AdminAuthConsumer, { props: { onresolve: vi.fn() } })).toThrow();
	});
});
