import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return {
				id: 't1',
				title: 'テストテーマ',
				phase: 'stakeholders',
				phaseStatus: 'generated'
			};
		},
		get stakeholdersStore() {
			return {
				stakeholders: [
					{
						role: '外科医師',
						minorityLevel: 'low',
						reason: '専門的見地',
						engagementLevel: 'medium'
					}
				],
				isLoaded: true
			};
		}
	}
}));

import GenerateStakeholdersPage from '$lib/features/admin/topic-detail/stakeholders/GenerateStakeholdersPage.svelte';

describe('GenerateStakeholdersPage.svelte', () => {
	it('ステークホルダーリストを表示する', async () => {
		render(GenerateStakeholdersPage);
		await expect.element(page.getByText('外科医師')).toBeInTheDocument();
	});
});
