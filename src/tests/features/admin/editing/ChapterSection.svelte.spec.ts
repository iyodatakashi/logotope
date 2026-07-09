import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ChapterSection, {
	type DisplayTurn
} from '$lib/features/admin/topic-detail/editing/ChapterSection.svelte';
import type { EditedChapterDisplayStatus } from '$lib/models/editedChapter/editedChapter.types';

const turn = (overrides: Partial<DisplayTurn> = {}): DisplayTurn => ({
	id: 't1',
	name: '田中',
	role: '住民',
	content: '原本の発言',
	diff: null,
	removed: false,
	awarenesses: [],
	...overrides
});

const makeProps = (overrides: Record<string, unknown> = {}) => ({
	title: '第一章',
	status: 'completed' as EditedChapterDisplayStatus,
	failureReason: null,
	showRegenerate: false,
	turns: [turn()],
	showDiff: false,
	onRegenerate: vi.fn(),
	...overrides
});

const regenerate = () => page.getByRole('button', { name: '再生成' });

describe('ChapterSection.svelte', () => {
	it('章タイトルとステータスラベル（編集済み/原本表示（失敗）/未編集）を出す', async () => {
		render(ChapterSection, makeProps({ status: 'completed' }));
		await expect.element(page.getByText('第一章')).toBeInTheDocument();
		await expect.element(page.getByText('編集済み')).toBeInTheDocument();
	});

	it('失敗章は「原本表示（失敗）」と検証不合格の理由を出す', async () => {
		render(
			ChapterSection,
			makeProps({ status: 'failed', failureReason: '原本に存在しない sourceTurnId: ghost' })
		);
		await expect.element(page.getByText('原本表示（失敗）')).toBeInTheDocument();
		await expect.element(page.getByText(/検証不合格.*ghost/)).toBeInTheDocument();
	});

	it('未編集章は原本ターンをそのまま出す', async () => {
		render(ChapterSection, makeProps({ status: 'missing' }));
		await expect.element(page.getByText('未編集')).toBeInTheDocument();
		await expect.element(page.getByText('原本の発言')).toBeInTheDocument();
	});

	it('showRegenerate=false では再生成ボタンを出さない', async () => {
		render(ChapterSection, makeProps({ showRegenerate: false }));
		expect(regenerate().elements()).toHaveLength(0);
	});

	it('showRegenerate=true で押下すると onRegenerate を呼び、処理中は無効化する（ローディング自持ち）', async () => {
		let resolve!: () => void;
		const onRegenerate = vi.fn(() => new Promise<void>((r) => (resolve = r)));
		render(ChapterSection, makeProps({ status: 'failed', showRegenerate: true, onRegenerate }));

		const button = regenerate();
		await button.click();
		expect(onRegenerate).toHaveBeenCalledOnce();
		await expect.element(button).toBeDisabled();

		resolve();
		await expect.element(button).toBeEnabled();
	});

	it('削除ターンは差分表示オン時のみ「発言ごと削除」で出す', async () => {
		const removed = turn({ id: 'r1', content: '削除された発言', removed: true });
		render(ChapterSection, makeProps({ turns: [removed], showDiff: true }));
		await expect.element(page.getByText('発言ごと削除')).toBeInTheDocument();
		await expect.element(page.getByText('削除された発言')).toBeInTheDocument();
	});
});
