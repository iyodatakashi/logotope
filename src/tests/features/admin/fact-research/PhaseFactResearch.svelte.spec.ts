import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const { mockApproveFactResearch, mockGoto } = vi.hoisted(() => ({
	mockApproveFactResearch: vi.fn(),
	mockGoto: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto: mockGoto }));

let phaseStatus = 'not_started';
let factBaseData: unknown = null;

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return {
				id: 't1',
				title: 'テストテーマ',
				phase: 'fact-research',
				phaseStatus,
				approveFactResearch: mockApproveFactResearch,
				generateFactResearch: vi.fn()
			};
		},
		get factBaseStore() {
			return {
				get data() {
					return factBaseData;
				},
				isLoaded: true,
				save: vi.fn()
			};
		}
	}
}));

import FactResearchPage from '$lib/features/admin/topic-detail/fact-research/FactResearchPage.svelte';

describe('FactResearchPage.svelte', () => {
	it('未実行（not_started）で「実行する」と「実行せず承認する」の両導線を表示する', async () => {
		phaseStatus = 'not_started';
		factBaseData = null;
		render(FactResearchPage);
		await expect
			.element(page.getByRole('button', { name: '事実リサーチを実行する' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: '実行せず承認する' }))
			.toBeInTheDocument();
	});

	it('「実行せず承認する」で空のまま承認し次フェーズへ前進する', async () => {
		phaseStatus = 'not_started';
		factBaseData = null;
		render(FactResearchPage);
		await page.getByRole('button', { name: '実行せず承認する' }).click();
		expect(mockApproveFactResearch).toHaveBeenCalledOnce();
		expect(mockGoto).toHaveBeenCalledWith('/admin/topics/t1/stakeholders');
	});

	it('生成済み（generated）で事実基盤の statement を編集可能に表示する（編集は自動保存）', async () => {
		phaseStatus = 'generated';
		factBaseData = {
			facts: [
				{ statement: '日本は1回戦で敗退した', sources: [{ title: '報知', url: 'https://a' }] }
			],
			generatedAt: { __ts: 'now' }
		};
		render(FactResearchPage);
		await expect.element(page.getByText('承認して次へ進む')).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '再実行する' })).toBeInTheDocument();
		// statement は編集可能な入力欄として出る（保存ボタンは持たず、変更確定時に自動保存する）
		await expect.element(page.getByRole('textbox')).toHaveValue('日本は1回戦で敗退した');
	});
});
