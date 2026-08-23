import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ADMIN_AUTH_CONFIG, SELF_REGISTRATION } from '$lib/models/auth/admin-auth.constants';

describe('ADMIN_AUTH_CONFIG', () => {
	it('経路の全項目が管理画面の配下を指す', () => {
		const outside = Object.entries(ADMIN_AUTH_CONFIG.routes).filter(
			([, path]) => !path.startsWith('/admin/')
		);

		expect(outside).toEqual([]);
	});

	it('メールアドレスの確認を求めない', () => {
		expect(ADMIN_AUTH_CONFIG.emailVerification).toBe(false);
	});

	it('戻り先が管理画面のサインインの経路で終わる', () => {
		expect(ADMIN_AUTH_CONFIG.continueUrl).toMatch(/^https?:\/\/.+/);
		expect(ADMIN_AUTH_CONFIG.continueUrl.endsWith(ADMIN_AUTH_CONFIG.routes.signIn)).toBe(true);
	});

	it('既定の行き先が実在するトピック一覧である', () => {
		expect(ADMIN_AUTH_CONFIG.routes.afterSignIn).toBe('/admin/topics');
	});
});

describe('自前登録のスイッチ', () => {
	it('コード側のスイッチは環境変数ひとつだけで、他に真偽値の直書きが無い', () => {
		const source = readFileSync('src/lib/models/auth/admin-auth.constants.ts', 'utf8');

		expect(source).toContain('import.meta.env.VITE_SELF_REGISTRATION');
		expect(source).not.toMatch(/selfRegistration:\s*(true|false)/);
	});

	it('画面の入口はスイッチに従う', () => {
		expect(ADMIN_AUTH_CONFIG.selfRegistration).toBe(SELF_REGISTRATION);
	});

	it('登録の経路の値がスイッチに従う（許さないならサインインに重ねる）', () => {
		expect(ADMIN_AUTH_CONFIG.routes.signUp).toBe(
			SELF_REGISTRATION ? '/admin/signup' : ADMIN_AUTH_CONFIG.routes.signIn
		);
	});

	it('登録の経路は常に実在し、到達可否を同じスイッチで塞ぐ', () => {
		const guard = readFileSync('src/routes/admin/signup/+page.ts', 'utf8');

		expect(guard).toContain('SELF_REGISTRATION');
		expect(guard).toContain('redirect(');
	});
});
