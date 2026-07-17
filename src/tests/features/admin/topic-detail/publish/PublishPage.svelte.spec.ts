import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

let unmount: (() => void) | undefined;
const mount = () => {
	const result = render(PublishPage);
	unmount = result.unmount;
	return result;
};

const { spies, state } = vi.hoisted(() => ({
	spies: {
		publishDebate: vi.fn(),
		unpublishDebate: vi.fn()
	},
	state: {
		published: false as boolean
	}
}));

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return {
				id: 't1',
				get published() {
					return state.published;
				},
				publishDebate: spies.publishDebate,
				unpublishDebate: spies.unpublishDebate
			};
		}
	}
}));

import PublishPage from '$lib/features/admin/topic-detail/publish/PublishPage.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	state.published = false;
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
});

describe('PublishPage', () => {
	it('非公開のときスイッチは OFF を表示する', async () => {
		mount();

		await expect.element(page.getByRole('checkbox', { name: '公開' })).not.toBeChecked();
	});

	it('公開中のときスイッチは ON を表示する', async () => {
		state.published = true;
		mount();

		await expect.element(page.getByRole('checkbox', { name: '公開' })).toBeChecked();
	});

	// Switch の input は sr-only（1px クリップ）でクリック不可のため、change を直接発火して操作を検証する。
	const toggleSwitch = (checked: boolean) => {
		const input = page.getByRole('checkbox', { name: '公開' }).element() as HTMLInputElement;
		input.checked = checked;
		input.dispatchEvent(new Event('change', { bubbles: true }));
	};

	it('OFF から操作すると publishDebate を呼ぶ', async () => {
		mount();

		toggleSwitch(true);

		expect(spies.publishDebate).toHaveBeenCalledOnce();
		expect(spies.unpublishDebate).not.toHaveBeenCalled();
	});

	it('ON から操作すると unpublishDebate を呼ぶ', async () => {
		state.published = true;
		mount();

		toggleSwitch(false);

		expect(spies.unpublishDebate).toHaveBeenCalledOnce();
		expect(spies.publishDebate).not.toHaveBeenCalled();
	});

	it('操作が失敗するとエラーを表示する', async () => {
		spies.publishDebate.mockRejectedValueOnce(new Error('失敗'));
		mount();

		toggleSwitch(true);

		await expect
			.element(page.getByText('公開状態の更新に失敗しました。時間をおいて再度お試しください。'))
			.toBeInTheDocument();
	});

	it('「前に戻る」で編集画面へ戻る', async () => {
		mount();

		await page.getByRole('button', { name: '前に戻る' }).click();

		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/editing');
	});
});
