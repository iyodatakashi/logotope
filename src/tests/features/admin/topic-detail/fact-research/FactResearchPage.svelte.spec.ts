import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

let unmount: (() => void) | undefined;
const mount = () => {
	const result = render(FactResearchPage);
	unmount = result.unmount;
	return result;
};

const { goto, spies, state } = vi.hoisted(() => ({
	goto: vi.fn(),
	spies: {
		generateFactResearch: vi.fn(),
		resetStakeholders: vi.fn(),
		resetPersonas: vi.fn(),
		resetChapters: vi.fn(),
		resetDebate: vi.fn(),
		resetEditing: vi.fn(),
		approveFactResearch: vi.fn()
	},
	state: {
		phase: 'fact-research' as string,
		phaseStatus: 'generated' as string,
		factBaseData: null as { facts: { statement: string; sources: unknown[] }[]; generatedAt: unknown } | null
	}
}));

vi.mock('$app/navigation', () => ({ goto }));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return {
				id: 't1',
				title: 'テストテーマ',
				get phase() {
					return state.phase;
				},
				get phaseStatus() {
					return state.phaseStatus;
				},
				generateFactResearch: spies.generateFactResearch,
				resetStakeholders: spies.resetStakeholders,
				resetPersonas: spies.resetPersonas,
				resetChapters: spies.resetChapters,
				resetDebate: spies.resetDebate,
				resetEditing: spies.resetEditing,
				approveFactResearch: spies.approveFactResearch
			};
		},
		get factBaseStore() {
			return {
				get data() {
					return state.factBaseData;
				},
				isLoaded: true,
				save: vi.fn()
			};
		}
	}
}));

import FactResearchPage from '$lib/features/admin/topic-detail/fact-research/FactResearchPage.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	state.phase = 'fact-research';
	state.phaseStatus = 'generated';
	state.factBaseData = null;
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
});

describe('FactResearchPage', () => {
	it('再実行は確認後にサーバ権威の単一操作のみを呼ぶ（下流 reset を呼ばない）', async () => {
		mount();

		await page.getByRole('button', { name: '再調査する' }).click();
		await page.getByRole('button', { name: '再実行する' }).click();

		expect(spies.generateFactResearch).toHaveBeenCalledOnce();
		expect(spies.resetStakeholders).not.toHaveBeenCalled();
		expect(spies.resetPersonas).not.toHaveBeenCalled();
		expect(spies.resetChapters).not.toHaveBeenCalled();
		expect(spies.resetDebate).not.toHaveBeenCalled();
		expect(spies.resetEditing).not.toHaveBeenCalled();
	});

	it('再実行押下直後は旧事実を即時に隠す（実削除の同期反映を待たない）', async () => {
		state.factBaseData = { facts: [{ statement: '旧事実', sources: [] }], generatedAt: {} };
		// 往復中（サーバがまだ running を書かず、旧事実も実削除前）の状態を模擬。
		spies.generateFactResearch.mockImplementation(() => new Promise<void>(() => {}));

		mount();

		await expect.element(page.getByText('旧事実').first()).toBeInTheDocument();

		await page.getByRole('button', { name: '再調査する' }).click();
		await page.getByRole('button', { name: '再実行する' }).click();

		// 実状態はまだ fact-research/generated（旧事実残存）だが、実行中スケルトンで即時に隠れる。
		expect(page.getByText('旧事実').elements()).toHaveLength(0);
	});
});
