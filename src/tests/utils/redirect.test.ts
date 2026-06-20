import { describe, it, expect } from 'vitest';
import { sanitizeAdminRedirect } from '$lib/utils/redirect';

describe('sanitizeAdminRedirect', () => {
	it('/admin 配下の相対パスはそのまま返す', () => {
		expect(sanitizeAdminRedirect('/admin/debate/t1/personas')).toBe('/admin/debate/t1/personas');
		expect(sanitizeAdminRedirect('/admin')).toBe('/admin');
	});

	it('null・空文字はダッシュボードへフォールバックする', () => {
		expect(sanitizeAdminRedirect(null)).toBe('/admin');
		expect(sanitizeAdminRedirect('')).toBe('/admin');
	});

	it('/admin 配下でないパスはダッシュボードへフォールバックする', () => {
		expect(sanitizeAdminRedirect('/debate/t1')).toBe('/admin');
		expect(sanitizeAdminRedirect('https://evil.example.com/admin')).toBe('/admin');
		expect(sanitizeAdminRedirect('//evil.example.com/admin')).toBe('/admin');
		expect(sanitizeAdminRedirect('/adminx')).toBe('/admin');
	});

	it('ログインページ自身への復帰はダッシュボードへフォールバックする', () => {
		expect(sanitizeAdminRedirect('/admin/login')).toBe('/admin');
	});
});
