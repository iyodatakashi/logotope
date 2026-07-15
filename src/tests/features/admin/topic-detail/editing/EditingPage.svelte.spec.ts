import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

let unmount: (() => void) | undefined;
const mount = () => {
	const result = render(EditingPage);
	unmount = result.unmount;
	return result;
};

const emptyNarration = { status: 'pending' as const, draft: null, final: null };

const { spies, state } = vi.hoisted(() => ({
	spies: {
		startEditing: vi.fn(),
		resetEditing: vi.fn(),
		regenerateArticleElement: vi.fn()
	},
	state: {
		// editing フェーズにいる（討論は通過済み＝debateCompleted）。
		phase: 'editing' as string,
		phaseStatus: 'generated' as string
	}
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return {
				id: 't1',
				get phase() {
					return state.phase;
				},
				get phaseStatus() {
					return state.phaseStatus;
				},
				startEditing: spies.startEditing,
				resetEditing: spies.resetEditing,
				regenerateArticleElement: spies.regenerateArticleElement
			};
		},
		get editedChaptersStore() {
			return {
				getDisplayStatus: () => 'pending',
				getEditedChapter: () => null
			};
		},
		get editorialStore() {
			return {
				intro: emptyNarration,
				outro: emptyNarration,
				impressions: []
			};
		},
		get personasStore() {
			return { personas: [] };
		},
		get chaptersStore() {
			return { chapters: [] };
		}
	}
}));

import EditingPage from '$lib/features/admin/topic-detail/editing/EditingPage.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	state.phase = 'editing';
	state.phaseStatus = 'generated';
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
});

describe('EditingPage', () => {
	it('やり直しは確認後に startEditing のみを呼ぶ（resetEditing を呼ばない）', async () => {
		mount();

		await page.getByRole('button', { name: '編集をやり直す', exact: true }).nth(0).click();
		await page.getByRole('button', { name: '編集をやり直す', exact: true }).nth(1).click();

		expect(spies.startEditing).toHaveBeenCalledOnce();
		expect(spies.resetEditing).not.toHaveBeenCalled();
	});
});
