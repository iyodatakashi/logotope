import { getContext, setContext } from 'svelte';
import type { AuthStore } from '@14ch/svelte-firebase-auth';

// context のキーはこのファイルの外に出さない
const ADMIN_AUTH_KEY = Symbol('adminAuth');

export const setAdminAuthStore = (store: AuthStore): void => {
	setContext(ADMIN_AUTH_KEY, store);
};

export const getAdminAuthStore = (): AuthStore => {
	const store = getContext<AuthStore | undefined>(ADMIN_AUTH_KEY);
	if (!store) {
		// null を返して呼び出し側に分岐を作らせない。/admin の外から呼んだ実装の誤り
		throw new Error('認証ストアが登録されていない階層で getAdminAuthStore が呼ばれた');
	}
	return store;
};
