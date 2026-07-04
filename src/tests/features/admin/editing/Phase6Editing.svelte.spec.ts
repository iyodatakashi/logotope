import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { holder } = vi.hoisted(() => ({
	holder: {
		phase: 'editing',
		phaseStatus: 'generated',
		startEditing: vi.fn(),
		resetEditing: vi.fn(),
		// 原本章（id/turns）
		chapters: [] as unknown[],
		// editedChapters ストアの getter が返す値
		editedByChapter: new Map<string, { status: string; turns?: unknown[] }>(),
		factResults: new Map<string, unknown>(),
		personas: [] as unknown[]
	}
}));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return {
				id: 'test-topic',
				phase: holder.phase,
				phaseStatus: holder.phaseStatus,
				startEditing: holder.startEditing,
				resetEditing: holder.resetEditing
			};
		},
		get chaptersStore() {
			return {
				get chapters() {
					return holder.chapters;
				}
			};
		},
		get editedChaptersStore() {
			return {
				getDisplayStatus: (chapterId: string) =>
					holder.editedByChapter.get(chapterId)?.status ?? 'missing',
				getEditedChapter: (chapterId: string) => holder.editedByChapter.get(chapterId) ?? null
			};
		},
		get personasStore() {
			return {
				get personas() {
					return holder.personas;
				}
			};
		},
		get factCheckStore() {
			return {
				get resultsMap() {
					return holder.factResults;
				}
			};
		}
	}
}));

import Phase6Editing from '$lib/features/admin/topic-detail/editing/Phase6Editing.svelte';

const persona = (id: string, name: string) => ({
	id,
	name,
	stakeholderRole: '役割',
	specificRole: '',
	beliefs: []
});

describe('Phase6Editing.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		holder.phase = 'editing';
		holder.phaseStatus = 'generated';
		holder.chapters = [];
		holder.editedByChapter = new Map();
		holder.factResults = new Map();
		holder.personas = [persona('p1', '田中太郎')];
	});

	// 差分が確定的になるよう、原本と編集後で文字集合を重複させないデータを使う。
	const completedChapterFixture = () => {
		holder.chapters = [
			{
				id: 'ch1',
				title: '第一章',
				turns: [{ id: 't1', speakerType: 'persona', personaId: 'p1', content: 'アイウエオ' }]
			}
		];
		holder.editedByChapter = new Map([
			[
				'ch1',
				{
					status: 'completed',
					turns: [
						{
							id: 'e1',
							sourceTurnIds: ['t1'],
							speakerType: 'persona',
							personaId: 'p1',
							content: 'カキクケコ'
						}
					]
				}
			]
		]);
	};

	it('完了章は既定で原本との差分（削除＋追加）を強調表示し、章別ステータスに「編集済み」を出す', async () => {
		completedChapterFixture();
		render(Phase6Editing);

		await expect.element(page.getByText('編集済み')).toBeInTheDocument();
		// 既定は差分表示 ON。削除された原本テキストと追加された編集後テキストの両方が見える。
		await expect.element(page.getByText('カキクケコ')).toBeInTheDocument();
		await expect.element(page.getByText('アイウエオ')).toBeInTheDocument();
	});

	it('差分表示をオフにすると原本（削除）テキストが消え、編集後のみになる', async () => {
		completedChapterFixture();
		render(Phase6Editing);

		await expect.element(page.getByText('アイウエオ')).toBeInTheDocument();
		await page.getByRole('checkbox').click();

		expect(page.getByText('アイウエオ').elements()).toHaveLength(0);
		await expect.element(page.getByText('カキクケコ')).toBeInTheDocument();
	});

	it('失敗章は原本ターンにフォールバックし、章別ステータスに「原本表示（失敗）」を出す', async () => {
		holder.chapters = [
			{
				id: 'ch1',
				title: '第一章',
				turns: [{ id: 't1', speakerType: 'persona', personaId: 'p1', content: '原本の発言' }]
			}
		];
		holder.editedByChapter = new Map([['ch1', { status: 'failed', turns: [] }]]);
		render(Phase6Editing);

		await expect.element(page.getByText('原本の発言')).toBeInTheDocument();
		await expect.element(page.getByText('原本表示（失敗）')).toBeInTheDocument();
	});

	it('失敗章は検証不合格の理由を表示する（原因把握）', async () => {
		holder.chapters = [
			{
				id: 'ch1',
				title: '第一章',
				turns: [{ id: 't1', speakerType: 'persona', personaId: 'p1', content: '原本の発言' }]
			}
		];
		holder.editedByChapter = new Map([
			[
				'ch1',
				{ status: 'failed', turns: [], failureReason: '原本に存在しない sourceTurnId: ghost' }
			]
		]);
		render(Phase6Editing);

		await expect.element(page.getByText(/検証不合格.*ghost/)).toBeInTheDocument();
	});

	// 2発言のうち t2 がどの編集後ターンにも由来しない（発言ごとカット）ケース。
	const cutTurnFixture = () => {
		holder.chapters = [
			{
				id: 'ch1',
				title: '第一章',
				turns: [
					{ id: 't1', speakerType: 'persona', personaId: 'p1', content: '残る発言アイウ' },
					{ id: 't2', speakerType: 'persona', personaId: 'p1', content: 'カットされる発言マミム' }
				]
			}
		];
		holder.editedByChapter = new Map([
			[
				'ch1',
				{
					status: 'completed',
					turns: [
						{
							id: 'e1',
							sourceTurnIds: ['t1'],
							speakerType: 'persona',
							personaId: 'p1',
							content: '残る発言カキク'
						}
					]
				}
			]
		]);
	};

	it('差分表示時、どの編集後ターンにも使われなかった原本発言を「発言ごと削除」として表示する', async () => {
		cutTurnFixture();
		render(Phase6Editing);

		await expect.element(page.getByText('発言ごと削除')).toBeInTheDocument();
		await expect.element(page.getByText('カットされる発言マミム')).toBeInTheDocument();
	});

	it('差分表示をオフにするとカットされた発言は表示しない', async () => {
		cutTurnFixture();
		render(Phase6Editing);

		await expect.element(page.getByText('カットされる発言マミム')).toBeInTheDocument();
		await page.getByRole('checkbox').click();

		expect(page.getByText('カットされる発言マミム').elements()).toHaveLength(0);
		expect(page.getByText('発言ごと削除').elements()).toHaveLength(0);
	});

	it('未生成章は原本にフォールバックし「未編集」を出す', async () => {
		holder.chapters = [
			{
				id: 'ch1',
				title: '第一章',
				turns: [{ id: 't1', speakerType: 'persona', personaId: 'p1', content: '原本の発言' }]
			}
		];
		render(Phase6Editing);

		await expect.element(page.getByText('原本の発言')).toBeInTheDocument();
		await expect.element(page.getByText('未編集')).toBeInTheDocument();
	});

	it('完了章の編集後ターンに、由来ターンの気づきを結合表示する', async () => {
		holder.personas = [
			{
				id: 'p1',
				name: '田中太郎',
				stakeholderRole: '役割',
				specificRole: '',
				awarenesses: [
					{
						id: 'a1',
						triggeredByTurnId: 't1',
						kind: 'self',
						content: '別の見方に一理ある',
						sourcePersonaId: null
					}
				]
			}
		];
		holder.chapters = [
			{
				id: 'ch1',
				title: '第一章',
				turns: [{ id: 't1', speakerType: 'persona', personaId: 'p1', content: '原本' }]
			}
		];
		holder.editedByChapter = new Map([
			[
				'ch1',
				{
					status: 'completed',
					turns: [
						{
							id: 'e1',
							sourceTurnIds: ['t1'],
							speakerType: 'persona',
							personaId: 'p1',
							content: '編集後'
						}
					]
				}
			]
		]);
		render(Phase6Editing);

		await expect.element(page.getByText(/別の見方に一理ある/)).toBeInTheDocument();
	});

	it('未実行（not_started）時は「編集を開始する」ボタンを表示し、押下で startEditing を呼ぶ', async () => {
		holder.phaseStatus = 'not_started';
		render(Phase6Editing);

		const startButton = page.getByRole('button', { name: '編集を開始する' });
		await expect.element(startButton).toBeInTheDocument();
		await startButton.click();
		expect(holder.startEditing).toHaveBeenCalled();
	});
});
