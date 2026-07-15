import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

let unmount: (() => void) | undefined;
const mount = () => {
	const result = render(GenerateDebatePage);
	unmount = result.unmount;
	return result;
};

const { goto, spies, state } = vi.hoisted(() => ({
	goto: vi.fn(),
	spies: {
		startDebate: vi.fn(),
		restartDebate: vi.fn(),
		stopDebate: vi.fn(),
		resetDebate: vi.fn(),
		resetEditing: vi.fn(),
		approveDebate: vi.fn()
	},
	state: {
		phase: 'debate' as string,
		phaseStatus: 'generated' as string,
		chapters: [] as unknown[]
	}
}));

vi.mock('$app/navigation', () => ({ goto }));

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
				startDebate: spies.startDebate,
				restartDebate: spies.restartDebate,
				stopDebate: spies.stopDebate,
				resetDebate: spies.resetDebate,
				resetEditing: spies.resetEditing,
				approveDebate: spies.approveDebate
			};
		},
		get chaptersStore() {
			return {
				get chapters() {
					return state.chapters;
				},
				get currentChapter() {
					return null;
				}
			};
		}
	}
}));

import GenerateDebatePage from '$lib/features/admin/topic-detail/debate/GenerateDebatePage.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	state.phase = 'debate';
	state.phaseStatus = 'generated';
	state.chapters = [];
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
});

describe('GenerateDebatePage', () => {
	it('やり直しは確認後にサーバ権威の単一操作のみを呼ぶ（下流 reset を呼ばない）', async () => {
		mount();

		await page.getByRole('button', { name: '最初からやり直す', exact: true }).nth(0).click();
		await page.getByRole('button', { name: '最初からやり直す', exact: true }).nth(1).click();

		expect(spies.startDebate).toHaveBeenCalledOnce();
		expect(spies.resetDebate).not.toHaveBeenCalled();
		expect(spies.resetEditing).not.toHaveBeenCalled();
	});
});
