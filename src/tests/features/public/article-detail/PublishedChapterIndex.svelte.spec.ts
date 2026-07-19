import { page } from 'vitest/browser';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

// IntersectionObserver をモックしてコールバックを捕捉し、スクロール追従の現在地強調を検証する。
let observerCb: ((entries: unknown[]) => void) | null = null;
class MockIntersectionObserver {
	constructor(cb: (entries: unknown[]) => void) {
		observerCb = cb;
	}
	observe() {}
	disconnect() {}
}

import PublishedChapterIndex from '$lib/features/public/article-detail/PublishedChapterIndex.svelte';

const chapters = [
	{ index: 0, title: '第一章' },
	{ index: 1, title: '第二章' }
];

describe('PublishedChapterIndex', () => {
	afterEach(() => {
		observerCb = null;
		vi.unstubAllGlobals();
	});

	it('章リンクを #chapter-{index} で描画し、要素差し替え（<strong>）を使わない（Req 4.2, 4.4）', async () => {
		vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
		render(PublishedChapterIndex, { chapters });
		await expect
			.element(page.getByRole('link', { name: '第一章' }))
			.toHaveAttribute('href', '#chapter-0');
		await expect
			.element(page.getByRole('link', { name: '第二章' }))
			.toHaveAttribute('href', '#chapter-1');
		expect(document.querySelector('.published-chapter-index strong')).toBeNull();
	});

	it('可視章の目次項目に状態クラス --active が付く（Req 4.3, 4.4）', async () => {
		vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
		render(PublishedChapterIndex, { chapters });
		observerCb?.([{ isIntersecting: true, target: { getAttribute: () => '1' } }]);
		await vi.waitFor(() => {
			const active = document.querySelector('.published-chapter-index__item--active');
			expect(active?.textContent).toContain('第二章');
		});
		// 強調は状態クラスで表現し、要素差し替え（<strong>）はしない。
		expect(document.querySelector('.published-chapter-index strong')).toBeNull();
	});
});
