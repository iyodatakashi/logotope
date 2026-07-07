import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { topicHolder } = vi.hoisted(() => ({
	topicHolder: {
		approveDebate: vi.fn()
	}
}));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return {
				id: 'test-topic',
				phase: 'debate',
				phaseStatus: 'generated',
				approveDebate: topicHolder.approveDebate
			};
		},
		get chaptersStore() {
			return {
				get chapters() {
					return [
						{
							id: 'ch1',
							chapterIndex: 0,
							title: 'テスト章',
							discussionPoints: [],
							turns: [
								{
									id: 't1',
									speakerType: 'persona',
									personaId: 'p1',
									content: 'テスト発言内容',
									createdAt: {},
									speechMode: undefined
								}
							],
							status: 'completed'
						}
					];
				},
				get turns() {
					return [
						{
							id: 't1',
							turnIndex: 1,
							speakerType: 'persona',
							personaId: 'p1',
							content: 'テスト発言内容',
							createdAt: {},
							speechMode: undefined
						}
					];
				},
				get currentChapter() {
					return null;
				}
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
					return new Map([['t1', [{ turnId: 't1', score: 4, mode: 'opinion', personaId: 'p2' }]]]);
				},
				start: vi.fn(),
				stop: vi.fn()
			};
		}
	}
}));

import GenerateDebatePage from '$lib/features/admin/topic-detail/debate/GenerateDebatePage.svelte';

describe('GenerateDebatePage.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('討論 generated 時に「討論を確定して編集へ」ボタンを表示し、押下で approveDebate を呼ぶ', async () => {
		render(GenerateDebatePage);

		const approveButton = page.getByRole('button', { name: '討論を確定して編集へ' });
		await expect.element(approveButton).toBeInTheDocument();

		await approveButton.click();
		expect(topicHolder.approveDebate).toHaveBeenCalled();
	});

	it('ターンの発言内容を表示する', async () => {
		render(GenerateDebatePage);

		await expect.element(page.getByText('テスト発言内容')).toBeInTheDocument();
	});

	it('engagementsストアからエンゲージメントデータを表示する', async () => {
		render(GenerateDebatePage);

		// p2 with mode='opinion', score=4 → displayed as "鈴木花子: full(4)"
		await expect.element(page.getByText(/鈴木花子/)).toBeInTheDocument();
	});

	it('「前のフェーズに戻る」ボタンは存在しない', async () => {
		render(GenerateDebatePage);

		await expect.element(page.getByText('テスト発言内容')).toBeInTheDocument();
		expect(page.getByRole('button', { name: '前のフェーズに戻る' }).elements()).toHaveLength(0);
	});

	it('討論完了時は公開ボタンを描画しない（ターン完了後のみ表示）', async () => {
		render(GenerateDebatePage);

		await expect.element(page.getByText('テスト発言内容')).toBeInTheDocument();
	});
});
