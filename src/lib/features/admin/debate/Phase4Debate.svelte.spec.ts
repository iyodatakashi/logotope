import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$lib/stores/session.svelte.js', () => ({
	createSessionStore: vi.fn(() => ({
		get session() {
			return {
				turns: [
					{
						id: 't1',
						turnIndex: 1,
						speakerType: 'persona',
						personaId: 'p1',
						content: 'テスト発言内容',
						createdAt: {},
						speechMode: undefined
					}
				],
				status: 'completed',
				createdAt: {},
				postDebateComments: [],
				totalTurns: 2
			};
		},
		get isLoaded() {
			return true;
		},
		start: vi.fn(),
		stop: vi.fn()
	}))
}));

vi.mock('$lib/stores/personas.svelte.js', () => ({
	createPersonasStore: vi.fn(() => ({
		get personas() {
			return [
				{
					id: 'p1',
					name: '田中太郎',
					stakeholderRole: '医師',
					beliefs: [],
					approved: true,
					age: 45,
					occupation: '外科医',
					background: '',
					interests: '',
					stanceDirection: 'pro',
					sortOrder: 0,
					topicId: 't1'
				},
				{
					id: 'p2',
					name: '鈴木花子',
					stakeholderRole: '患者',
					beliefs: [],
					approved: true,
					age: 35,
					occupation: '会社員',
					background: '',
					interests: '',
					stanceDirection: 'against',
					sortOrder: 1,
					topicId: 't1'
				}
			];
		},
		get isLoaded() {
			return true;
		},
		start: vi.fn(),
		stop: vi.fn(),
		approvePersonas: vi.fn(),
		resetPersonas: vi.fn()
	}))
}));

vi.mock('$lib/stores/topic.svelte.js', () => ({
	createTopicStore: vi.fn(() => ({
		get isLoaded() {
			return true;
		},
		start: vi.fn(),
		stop: vi.fn(),
		resetToPhase3: vi.fn(),
		publishDebate: vi.fn()
	}))
}));

vi.mock('$lib/stores/engagements.svelte.js', () => ({
	createEngagementsStore: vi.fn(() => ({
		get engagementsMap() {
			return new Map([[1, [{ turnIndex: 1, score: 4, mode: 'full', personaId: 'p2' }]]]);
		},
		start: vi.fn(),
		stop: vi.fn()
	}))
}));

vi.mock('$lib/api/topics.js', () => ({
	startDebate: vi.fn().mockResolvedValue(undefined)
}));

import Phase4Debate from '$lib/features/admin/debate/Phase4Debate.svelte';

describe('Phase4Debate.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('ターンの発言内容を表示する', async () => {
		render(Phase4Debate, { topicId: 'test-topic', topicTitle: 'テストトピック' });

		await expect.element(page.getByText('テスト発言内容')).toBeInTheDocument();
	});

	it('engagementsストアからエンゲージメントデータを表示する', async () => {
		render(Phase4Debate, { topicId: 'test-topic', topicTitle: 'テストトピック' });

		// p2 with mode='full', score=4 → displayed as "鈴木花子: full(4)"
		await expect.element(page.getByText(/鈴木花子/)).toBeInTheDocument();
	});

	it('「前のフェーズに戻る」ボタンは存在しない', async () => {
		render(Phase4Debate, { topicId: 'test-topic', topicTitle: 'テストトピック' });

		await expect.element(page.getByText('テスト発言内容')).toBeInTheDocument();
		expect(page.getByRole('button', { name: '前のフェーズに戻る' }).elements()).toHaveLength(0);
	});

	it('readonly時は公開ボタンを描画せずデータは表示する', async () => {
		render(Phase4Debate, { topicId: 'test-topic', topicTitle: 'テストトピック', readonly: true });

		await expect.element(page.getByText('テスト発言内容')).toBeInTheDocument();
		expect(page.getByRole('button', { name: '公開する' }).elements()).toHaveLength(0);
	});
});
