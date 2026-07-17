import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TopicListItem from '$lib/features/topics/list/TopicListItem.svelte';
import type { TopicStates } from '$lib/models/topic/createTopic.svelte';

const topic = {
	id: 'debate-1',
	title: '消費税増税について',
	phase: 'debate' as const,
	phaseStatus: 'generated' as const,
	personaCount: 5,
	published: true,
	// ローカル日付で固定（toLocaleDateString → dayjs 置換で出力文字列が同一であることを担保）
	publishedAt: new Date(2026, 6, 6),
	createdAt: new Date(2026, 0, 1),
	updatedAt: new Date(2026, 6, 6)
} as unknown as TopicStates;

describe('TopicListItem.svelte', () => {
	it('テーマ名を表示する', async () => {
		render(TopicListItem, { topic });
		await expect.element(page.getByText('消費税増税について')).toBeInTheDocument();
	});

	it('ペルソナ数を表示する', async () => {
		render(TopicListItem, { topic });
		await expect.element(page.getByText(/5/)).toBeInTheDocument();
	});

	it('公開日を「YYYY年M月D日」形式で表示する（dayjs 置換後も出力同一・先頭ゼロなし）', async () => {
		render(TopicListItem, { topic });
		await expect.element(page.getByText('2026年7月6日')).toBeInTheDocument();
	});

	it('published=false のときは公開日を表示しない（判定は published で行う）', async () => {
		const unpublished = { ...topic, published: false } as unknown as TopicStates;
		render(TopicListItem, { topic: unpublished });
		expect(page.getByText('2026年7月6日').elements()).toHaveLength(0);
	});

	it('討論詳細ページへのリンクを持つ', async () => {
		render(TopicListItem, { topic });
		const link = page.getByRole('link');
		await expect.element(link).toHaveAttribute('href', '/debate/debate-1');
	});
});
