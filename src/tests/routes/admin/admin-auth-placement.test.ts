import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

const sourcesUnder = (root: string): string[] =>
	readdirSync(root, { recursive: true, encoding: 'utf8' })
		.filter((entry) => /\.(ts|svelte)$/.test(entry))
		.map((entry) => `${root}/${entry}`);

const ADMIN_LAYOUT = 'src/routes/admin/+layout.svelte';
const DATA_SCOPE = 'src/lib/features/admin/AdminDataScope.svelte';

const allSources = sourcesUnder('src').filter((path) => !path.startsWith('src/tests/'));

describe('到達の制御の配置', () => {
	it('AuthGate が管理画面の階層にのみ現れる', () => {
		const usingGate = allSources.filter((path) =>
			/import\s*\{[^}]*\bAuthGate\b|<AuthGate\b/.test(read(path))
		);

		expect(usingGate).toEqual([ADMIN_LAYOUT]);
	});

	it('管理画面の階層に段階を見た条件式が無い', () => {
		const layout = read(ADMIN_LAYOUT);

		expect(layout).not.toMatch(/\{#if[^}]*\b(stage|isResolved|user|isLoggedIn)\b/);
	});

	it('管理データの購読が、サインアウト中も到達できる認証の経路に載らない', () => {
		// signed-out では認証の4経路が allow になる。認証の経路を含む階層に購読を置くと、
		// 未サインインのまま Firestore を購読してしまう
		const mounting = allSources.filter((path) => /<AdminDataScope\b/.test(read(path)));

		expect(mounting).toEqual(['src/routes/admin/topics/+layout.svelte']);
	});

	it('管理データの購読の包みが認証を参照しない', () => {
		const scope = read(DATA_SCOPE);

		expect(scope).not.toMatch(/stage|isLoggedIn|getAdminAuthStore|svelte-firebase-auth/);
	});

	it('管理画面の配下をクライアントサイドで動かす設定を維持する', () => {
		expect(read('src/routes/admin/+layout.ts')).toContain('ssr = false');
	});
});

describe('登録の経路', () => {
	it('登録の経路は実在し、スイッチで塞ぐ形になっている', () => {
		expect(readdirSync('src/routes/admin')).toContain('signup');
		expect(readdirSync('src/routes/admin/signup')).toContain('+page.ts');
	});
});

describe('自前実装の撤去', () => {
	it('削除した資産への参照が残っていない', () => {
		const offending = allSources.filter((path) =>
			/authStore|sanitizeAdminRedirect|\$lib\/utils\/redirect|stores\/auth\.svelte/.test(read(path))
		);

		expect(offending).toEqual([]);
	});

	it('削除したファイルが存在しない', () => {
		expect(existsSync('src/lib/stores/auth.svelte.ts')).toBe(false);
		expect(existsSync('src/lib/utils/redirect.ts')).toBe(false);
		expect(existsSync('src/tests/utils/redirect.test.ts')).toBe(false);
	});

	it('クエリによる復帰先の受け渡しを行わない', () => {
		const offending = allSources.filter((path) => /redirect=/.test(read(path)));

		expect(offending).toEqual([]);
	});

	it('認証の操作 API を直接呼ばない（初期化は logotope 側に残す）', () => {
		const offending = allSources
			.filter((path) => path !== 'src/lib/firebase.ts')
			.filter((path) => /from\s*['"]firebase\/auth['"]/.test(read(path)));

		expect(offending).toEqual([]);
	});

	it('認証インスタンスの初期化は logotope 側に残る', () => {
		expect(read('src/lib/firebase.ts')).toMatch(/getAuth\(/);
	});
});

describe('アクセス制御が緩められていない', () => {
	it('セキュリティルールがサインイン済みを条件とし、確認済みを条件に加えていない', () => {
		const rules = read('firestore.rules');

		expect(rules).toContain('request.auth != null');
		expect(rules).not.toMatch(/email_verified|emailVerified/);
	});

	it('呼び出し元の認証の検証が維持されている', () => {
		const auth = read('functions/src/utils/auth.ts');

		expect(auth).toContain('if (!request.auth)');
		expect(auth).toContain("throw new HttpsError('unauthenticated'");
	});
});
