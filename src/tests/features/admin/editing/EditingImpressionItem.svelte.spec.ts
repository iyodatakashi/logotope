import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { EditorialStatus } from '$lib/models/editorial/editorial.types';
import PostItem from '$lib/sharedComponents/PostItem.svelte';

// 話者ラベルは型に畳まず personaId から描画時に解決する（Turn と同じ責務境界・Req 3.1/3.4）。
// personaMap は store から直接引くため、テストでも store をモックして注入する。
const { personaMap } = vi.hoisted(() => ({
	personaMap: new Map<string, unknown>([['p1', { id: 'p1', name: '田中', role: '住民' }]])
}));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get personasStore() {
			return {
				getPersona: (id: string | null | undefined) => (id ? personaMap.get(id) : undefined)
			};
		}
	}
}));

import EditingImpression from '$lib/features/admin/topic-detail/editing/EditingImpressionItem.svelte';

// 所感は導入・締めと同一の状態別表示規則（進捗ステータス＋内容だけで決める・Req 6.2）。
const makeProps = (
	part: { status: EditorialStatus; draft: string | null; final: string | null },
	overrides: Record<string, unknown> = {}
) => ({
	personaId: 'p1',
	part,
	showDiff: false,
	onRegenerate: vi.fn(),
	...overrides
});

const regenerate = () => page.getByRole('button', { name: '再生成' });

describe('EditingImpression.svelte（状態駆動表示）', () => {
	it('話者名・役割は personaId から personaMap で描画時に解決する', async () => {
		render(EditingImpression, makeProps({ status: 'generating', draft: null, final: null }));
		await expect.element(page.getByText('田中')).toBeInTheDocument();
		await expect.element(page.getByText('住民')).toBeInTheDocument();
	});

	it('pending（未生成ペルソナ）: スケルトンのみ・段階ラベルも再生成も出さない', async () => {
		render(EditingImpression, makeProps({ status: 'pending', draft: null, final: null }));
		await expect.element(page.getByText('田中')).toBeInTheDocument();
		expect(regenerate().elements()).toHaveLength(0);
		expect(page.getByText('生成中').elements()).toHaveLength(0);
	});

	it('generating: 「生成中」ラベル・再生成なし', async () => {
		render(EditingImpression, makeProps({ status: 'generating', draft: null, final: null }));
		await expect.element(page.getByText('生成中')).toBeInTheDocument();
		expect(regenerate().elements()).toHaveLength(0);
	});

	it('編集済み（final あり）: 編集後本文を表示し再生成あり', async () => {
		render(
			EditingImpression,
			makeProps({ status: 'finished', draft: '原本', final: '所感編集後' })
		);
		await expect.element(page.getByText('所感編集後')).toBeInTheDocument();
		await expect.element(regenerate()).toBeInTheDocument();
	});

	it('編集失敗（原本のみ）: 原本本文＋「編集失敗」＋再生成', async () => {
		render(EditingImpression, makeProps({ status: 'finished', draft: '所感原本', final: null }));
		await expect.element(page.getByText('所感原本')).toBeInTheDocument();
		await expect.element(page.getByText('編集失敗')).toBeInTheDocument();
		await expect.element(regenerate()).toBeInTheDocument();
	});

	it('生成失敗（空）: 本文を出さず「生成失敗」＋再生成', async () => {
		render(EditingImpression, makeProps({ status: 'finished', draft: null, final: null }));
		await expect.element(page.getByText('生成失敗')).toBeInTheDocument();
		await expect.element(regenerate()).toBeInTheDocument();
	});

	it('押下すると onRegenerate を呼び、処理中はボタンを無効化する（ローディング自持ち）', async () => {
		let resolve!: () => void;
		const onRegenerate = vi.fn(() => new Promise<void>((r) => (resolve = r)));
		render(
			EditingImpression,
			makeProps({ status: 'finished', draft: null, final: null }, { onRegenerate })
		);

		const button = regenerate();
		await button.click();
		expect(onRegenerate).toHaveBeenCalledOnce();
		await expect.element(button).toBeDisabled();

		resolve();
		await expect.element(button).toBeEnabled();
	});
});
