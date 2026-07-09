import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ImpressionSection from '$lib/features/admin/topic-detail/editing/ImpressionSection.svelte';
import type { EditorialElementStatus } from '$lib/models/editorial/editorial.types';

// 所感は導入・締めと同一の状態別表示規則（進捗ステータス＋内容だけで決める・Req 6.2）。
const makeProps = (
	part: { status: EditorialElementStatus; draft: string | null; final: string | null },
	overrides: Record<string, unknown> = {}
) => ({
	name: '田中',
	role: '住民',
	part,
	showDiff: false,
	regenerating: false,
	onRegenerate: vi.fn(),
	...overrides
});

const regenerate = () => page.getByRole('button', { name: '再生成' });

describe('ImpressionSection.svelte（状態駆動表示）', () => {
	it('pending（未生成ペルソナ）: スケルトンのみ・段階ラベルも再生成も出さない', async () => {
		render(ImpressionSection, makeProps({ status: 'pending', draft: null, final: null }));
		await expect.element(page.getByText('田中')).toBeInTheDocument();
		expect(regenerate().elements()).toHaveLength(0);
		expect(page.getByText('生成中').elements()).toHaveLength(0);
	});

	it('generating: 「生成中」ラベル・再生成なし', async () => {
		render(ImpressionSection, makeProps({ status: 'generating', draft: null, final: null }));
		await expect.element(page.getByText('生成中')).toBeInTheDocument();
		expect(regenerate().elements()).toHaveLength(0);
	});

	it('編集済み（final あり）: 編集後本文を表示し再生成あり', async () => {
		render(ImpressionSection, makeProps({ status: 'finished', draft: '原本', final: '所感編集後' }));
		await expect.element(page.getByText('所感編集後')).toBeInTheDocument();
		await expect.element(regenerate()).toBeInTheDocument();
	});

	it('編集失敗（原本のみ）: 原本本文＋「編集失敗」＋再生成', async () => {
		render(ImpressionSection, makeProps({ status: 'finished', draft: '所感原本', final: null }));
		await expect.element(page.getByText('所感原本')).toBeInTheDocument();
		await expect.element(page.getByText('編集失敗')).toBeInTheDocument();
		await expect.element(regenerate()).toBeInTheDocument();
	});

	it('生成失敗（空）: 本文を出さず「生成失敗」＋再生成', async () => {
		render(ImpressionSection, makeProps({ status: 'finished', draft: null, final: null }));
		await expect.element(page.getByText('生成失敗')).toBeInTheDocument();
		await expect.element(regenerate()).toBeInTheDocument();
	});
});
