import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('$lib/stores/topic.svelte.js', () => ({
	createTopicStore: vi.fn(() => ({
		get topic() {
			return {
				id: 't1',
				title: 'テストテーマ',
				status: 'surveying',
				stakeholders: {
					items: [
						{ role: '外科医師', stanceDirection: 'pro', minorityLevel: 'low', reason: '専門的見地' }
					],
					approved: false
				}
			};
		},
		get isLoaded() {
			return true;
		},
		start: vi.fn(),
		stop: vi.fn(),
		generateStakeholders: vi.fn(),
		approveStakeholders: vi.fn()
	}))
}));

import Phase1Stakeholders from './Phase1Stakeholders.svelte';

describe('Phase1Stakeholders.svelte', () => {
	it('通常時はアクションボタンを表示する', async () => {
		render(Phase1Stakeholders, { topicId: 't1', topicTitle: 'テストテーマ' });

		await expect
			.element(page.getByRole('button', { name: '次のフェーズへ進む' }))
			.toBeInTheDocument();
	});

	it('readonly時はアクションUIを描画せずデータは表示する', async () => {
		render(Phase1Stakeholders, { topicId: 't1', topicTitle: 'テストテーマ', readonly: true });

		await expect.element(page.getByText('外科医師')).toBeInTheDocument();
		expect(page.getByRole('button', { name: '次のフェーズへ進む' }).elements()).toHaveLength(0);
		expect(page.getByRole('button', { name: '調査を開始する' }).elements()).toHaveLength(0);
	});
});
