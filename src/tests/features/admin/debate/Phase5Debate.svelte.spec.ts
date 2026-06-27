import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { fcHolder } = vi.hoisted(() => ({
	fcHolder: {
		map: new Map<string, unknown>(),
		runStates: new Map<string, { pending: boolean; error: string | null }>(),
		runFactCheck: vi.fn()
	}
}));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return { id: 'test-topic', phase: 5, phaseStatus: 'generated' };
		},
		get factCheckStore() {
			return {
				get resultsMap() {
					return fcHolder.map;
				},
				getRunState: (chapterId: string) =>
					fcHolder.runStates.get(chapterId) ?? { pending: false, error: null },
				runFactCheck: fcHolder.runFactCheck
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
							focusQuestion: '問いかけ',
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

import Phase5Debate from '$lib/features/admin/topic-detail/debate/Phase5Debate.svelte';

const makeResult = (chapterId: string, status: string, findings: unknown[] = []) => ({
	chapterId,
	status,
	findings,
	sources: [],
	startedAt: new Date()
});

const finding = {
	id: 'fc1',
	turnId: 't1',
	speakerType: 'persona',
	claim: 'テスト発言内容',
	verdict: 'incorrect',
	correction: 'これは誤りです',
	reason: 'ファクトチェックの理由',
	sources: [{ title: '出典タイトル', url: 'https://src.example' }]
};

describe('Phase5Debate.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fcHolder.map = new Map();
		fcHolder.runStates = new Map();
	});

	it('ターンの発言内容を表示する', async () => {
		render(Phase5Debate);

		await expect.element(page.getByText('テスト発言内容')).toBeInTheDocument();
	});

	it('engagementsストアからエンゲージメントデータを表示する', async () => {
		render(Phase5Debate);

		// p2 with mode='opinion', score=4 → displayed as "鈴木花子: full(4)"
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

	it('完了章にファクトチェック実行ボタンを表示する', async () => {
		render(Phase5Debate);

		await expect
			.element(page.getByRole('button', { name: /ファクトチェック/ }))
			.toBeInTheDocument();
	});

	it('ボタン押下で factCheckStore.runFactCheck を呼ぶ', async () => {
		render(Phase5Debate);

		await page.getByRole('button', { name: /ファクトチェック/ }).click();
		expect(fcHolder.runFactCheck).toHaveBeenCalledWith('ch1');
	});

	it('指摘を各発言の直下に表示する', async () => {
		fcHolder.map = new Map([['ch1', makeResult('ch1', 'completed', [finding])]]);
		render(Phase5Debate);

		await expect.element(page.getByText('これは誤りです')).toBeInTheDocument();
		await expect.element(page.getByText('ファクトチェックの理由')).toBeInTheDocument();
	});

	it('実行中（サーバーstatus=running）はボタンを無効化する', async () => {
		fcHolder.map = new Map([['ch1', makeResult('ch1', 'running')]]);
		render(Phase5Debate);

		await expect.element(page.getByRole('button', { name: /ファクトチェック/ })).toBeDisabled();
	});

	it('実行要求中（pending）はサーバー反映前でもボタンを無効化する', async () => {
		fcHolder.runStates = new Map([['ch1', { pending: true, error: null }]]);
		render(Phase5Debate);

		await expect.element(page.getByRole('button', { name: /ファクトチェック/ })).toBeDisabled();
	});

	it('サーバーstatus=failed のとき失敗を示す', async () => {
		fcHolder.map = new Map([['ch1', makeResult('ch1', 'failed')]]);
		render(Phase5Debate);

		await expect.element(page.getByText(/失敗/)).toBeInTheDocument();
	});

	it('呼び出しエラー時は失敗を示し、ボタンを再度有効化する', async () => {
		fcHolder.runStates = new Map([['ch1', { pending: false, error: 'internal' }]]);
		render(Phase5Debate);

		await expect.element(page.getByText(/失敗/)).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: /ファクトチェック/ })).toBeEnabled();
	});
});
