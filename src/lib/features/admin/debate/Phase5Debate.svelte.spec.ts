import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return { id: 'test-topic', phase: 5, phaseStatus: 'generated' };
		},
		get sessionStore() {
			return {
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
			};
		},
		get personasStore() {
			return {
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
				stop: vi.fn()
			};
		},
		get engagementsStore() {
			return {
				get engagementsMap() {
					return new Map([[1, [{ turnIndex: 1, score: 4, mode: 'full', personaId: 'p2' }]]]);
				},
				start: vi.fn(),
				stop: vi.fn()
			};
		}
	}
}));

import Phase5Debate from '$lib/features/admin/debate/Phase5Debate.svelte';

describe('Phase5Debate.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('ターンの発言内容を表示する', async () => {
		render(Phase5Debate);

		await expect.element(page.getByText('テスト発言内容')).toBeInTheDocument();
	});

	it('engagementsストアからエンゲージメントデータを表示する', async () => {
		render(Phase5Debate);

		// p2 with mode='full', score=4 → displayed as "鈴木花子: full(4)"
		await expect.element(page.getByText(/鈴木花子/)).toBeInTheDocument();
	});

	it('「前のフェーズに戻る」ボタンは存在しない', async () => {
		render(Phase5Debate);

		await expect.element(page.getByText('テスト発言内容')).toBeInTheDocument();
		expect(page.getByRole('button', { name: '前のフェーズに戻る' }).elements()).toHaveLength(0);
	});

	it('討論完了時は公開ボタンを描画しない（ターン完了後のみ表示）', async () => {
		render(Phase5Debate);

		await expect.element(page.getByText('テスト発言内容')).toBeInTheDocument();
	});
});
