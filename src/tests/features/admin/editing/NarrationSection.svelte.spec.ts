import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import NarrationSection from '$lib/features/admin/topic-detail/editing/NarrationSection.svelte';
import type { EditorialElementStatus } from '$lib/models/editorial/editorial.types';

// 表示は要素自身の進捗ステータス＋内容だけで決まる（ラン全体の完了フラグに依存しない）。
const makeProps = (
	part: { status: EditorialElementStatus; draft: string | null; final: string | null },
	overrides: Record<string, unknown> = {}
) => ({
	label: '導入',
	part,
	showDiff: false,
	onRegenerate: vi.fn(),
	...overrides
});

const regenerate = () => page.getByRole('button', { name: '再生成' });

describe('NarrationSection.svelte（状態駆動表示）', () => {
	describe('進行中はスケルトン（段階ラベル）・再生成なし', () => {
		it('pending: 段階ラベルも本文も再生成も出さない', async () => {
			render(NarrationSection, makeProps({ status: 'pending', draft: null, final: null }));
			expect(regenerate().elements()).toHaveLength(0);
			expect(page.getByText('生成中').elements()).toHaveLength(0);
			expect(page.getByText('編集中').elements()).toHaveLength(0);
		});

		it('generating: 「生成中」ラベルを出し再生成は出さない', async () => {
			render(NarrationSection, makeProps({ status: 'generating', draft: null, final: null }));
			await expect.element(page.getByText('生成中')).toBeInTheDocument();
			expect(regenerate().elements()).toHaveLength(0);
		});

		it('editing: 「編集中」ラベルを出し再生成は出さない', async () => {
			render(NarrationSection, makeProps({ status: 'editing', draft: '原本', final: null }));
			await expect.element(page.getByText('編集中')).toBeInTheDocument();
			expect(regenerate().elements()).toHaveLength(0);
		});
	});

	describe('完了は内容から成否を表示・再生成あり', () => {
		it('編集済み（final あり）: 編集後本文を表示し状態ラベルは出さない', async () => {
			render(NarrationSection, makeProps({ status: 'finished', draft: '原本', final: '編集後本文' }));
			await expect.element(page.getByText('編集後本文')).toBeInTheDocument();
			await expect.element(regenerate()).toBeInTheDocument();
			expect(page.getByText('編集失敗').elements()).toHaveLength(0);
			expect(page.getByText('生成失敗').elements()).toHaveLength(0);
		});

		it('編集失敗（原本のみ）: 原本本文＋「編集失敗」＋再生成', async () => {
			render(NarrationSection, makeProps({ status: 'finished', draft: '原本本文', final: null }));
			await expect.element(page.getByText('原本本文')).toBeInTheDocument();
			await expect.element(page.getByText('編集失敗')).toBeInTheDocument();
			await expect.element(regenerate()).toBeInTheDocument();
		});

		it('生成失敗（空）: 本文を出さず「生成失敗」＋再生成', async () => {
			render(NarrationSection, makeProps({ status: 'finished', draft: null, final: null }));
			await expect.element(page.getByText('生成失敗')).toBeInTheDocument();
			await expect.element(regenerate()).toBeInTheDocument();
		});
	});

	describe('再生成のローディングを自持ちする（委譲）', () => {
		it('押下すると onRegenerate を呼び、処理中はボタンを無効化する（二重実行防止）', async () => {
			let resolve!: () => void;
			const onRegenerate = vi.fn(() => new Promise<void>((r) => (resolve = r)));
			render(
				NarrationSection,
				makeProps({ status: 'finished', draft: '原本', final: null }, { onRegenerate })
			);

			const button = regenerate();
			await button.click();
			expect(onRegenerate).toHaveBeenCalledOnce();
			await expect.element(button).toBeDisabled();

			resolve();
			await expect.element(button).toBeEnabled();
		});
	});
});
