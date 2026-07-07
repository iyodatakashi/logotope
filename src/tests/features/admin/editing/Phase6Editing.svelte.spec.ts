import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

type Narration = { draft: string | null; final: string | null };
type Impression = { sortOrder: number; draft: string | null; final: string | null };

const { holder } = vi.hoisted(() => ({
	holder: {
		phase: 'editing',
		phaseStatus: 'generated',
		startEditing: vi.fn(),
		resetEditing: vi.fn(),
		regenerateArticleElement: vi.fn(),
		chapters: [] as unknown[],
		editedByChapter: new Map<
			string,
			{ status: string; turns?: unknown[]; failureReason?: string }
		>(),
		personas: [] as unknown[],
		intro: { draft: null, final: null } as Narration,
		outro: { draft: null, final: null } as Narration,
		impressions: {} as Record<string, Impression>
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
				resetEditing: holder.resetEditing,
				regenerateArticleElement: holder.regenerateArticleElement
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
		get editorialStore() {
			return {
				get intro() {
					return holder.intro;
				},
				get outro() {
					return holder.outro;
				},
				get impressions() {
					return holder.impressions;
				}
			};
		},
		get personasStore() {
			return {
				get personas() {
					return holder.personas;
				}
			};
		}
	}
}));

import EditingPage from '$lib/features/admin/topic-detail/editing/EditingPage.svelte';

const persona = (id: string, name: string) => ({
	id,
	name,
	stakeholderRole: '役割',
	specificRole: '',
	approved: true,
	beliefs: []
});

describe('EditingPage.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		holder.phase = 'editing';
		holder.phaseStatus = 'generated';
		holder.chapters = [];
		holder.editedByChapter = new Map();
		holder.personas = [persona('p1', '田中太郎')];
		holder.intro = { draft: null, final: null };
		holder.outro = { draft: null, final: null };
		holder.impressions = {};
		holder.regenerateArticleElement.mockResolvedValue(undefined);
	});

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
		render(EditingPage);

		await expect.element(page.getByText('編集済み')).toBeInTheDocument();
		await expect.element(page.getByText('カキクケコ')).toBeInTheDocument();
		await expect.element(page.getByText('アイウエオ')).toBeInTheDocument();
	});

	it('差分表示をオフにすると原本（削除）テキストが消え、編集後のみになる', async () => {
		completedChapterFixture();
		render(EditingPage);

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
		render(EditingPage);

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
		render(EditingPage);

		await expect.element(page.getByText(/検証不合格.*ghost/)).toBeInTheDocument();
	});

	it('未生成章は原本にフォールバックし「未編集」を出す', async () => {
		holder.chapters = [
			{
				id: 'ch1',
				title: '第一章',
				turns: [{ id: 't1', speakerType: 'persona', personaId: 'p1', content: '原本の発言' }]
			}
		];
		render(EditingPage);

		await expect.element(page.getByText('原本の発言')).toBeInTheDocument();
		await expect.element(page.getByText('未編集')).toBeInTheDocument();
	});

	it('未実行（not_started）時は「編集を開始する」ボタンを表示し、押下で startEditing を呼ぶ', async () => {
		holder.phaseStatus = 'not_started';
		render(EditingPage);

		const startButton = page.getByRole('button', { name: '編集を開始する' });
		await expect.element(startButton).toBeInTheDocument();
		await startButton.click();
		expect(holder.startEditing).toHaveBeenCalled();
	});

	it('記事を 導入 → 本体 → 締め → 所感 の順で表示する（編集後を final として表示）', async () => {
		holder.intro = { draft: '導入原本', final: 'これは導入の編集後本文です' };
		holder.outro = { draft: '締め原本', final: 'これは締めの編集後本文です' };
		holder.impressions = {
			p1: { sortOrder: 0, draft: '所感原本', final: 'これは所感の編集後本文です' }
		};
		completedChapterFixture();
		render(EditingPage);

		await expect.element(page.getByRole('heading', { name: '導入' })).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: '締め' })).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: '所感' })).toBeInTheDocument();
		await expect.element(page.getByText('これは導入の編集後本文です')).toBeInTheDocument();
		await expect.element(page.getByText('これは所感の編集後本文です')).toBeInTheDocument();
	});

	it('編集確定後、未完成の導入（原本のみ）に状態表示と再生成ボタンを出し、押下で intro を再生成する', async () => {
		holder.intro = { draft: '導入の原本のみ', final: null };
		holder.outro = { draft: '締め', final: '締め' };
		holder.impressions = { p1: { sortOrder: 0, draft: '所感', final: '所感' } };
		render(EditingPage);

		await expect.element(page.getByText('原本のみ（未編集）')).toBeInTheDocument();
		const button = page.getByRole('button', { name: '再生成' });
		await expect.element(button).toBeInTheDocument();
		await button.click();
		expect(holder.regenerateArticleElement).toHaveBeenCalledWith({ kind: 'intro' });
	});

	it('編集確定後、欠落した所感（生成失敗）に再生成ボタンを出し、押下で impression を再生成する', async () => {
		holder.intro = { draft: 'i', final: 'i' };
		holder.outro = { draft: 'o', final: 'o' };
		holder.impressions = {}; // p1 は欠落
		render(EditingPage);

		await expect.element(page.getByText('生成に失敗')).toBeInTheDocument();
		const button = page.getByRole('button', { name: '再生成' });
		await button.click();
		expect(holder.regenerateArticleElement).toHaveBeenCalledWith({
			kind: 'impression',
			personaId: 'p1'
		});
	});

	it('編集確定後、失敗章に再生成ボタンを出し、押下で chapter を再生成する', async () => {
		holder.intro = { draft: 'i', final: 'i' };
		holder.outro = { draft: 'o', final: 'o' };
		holder.impressions = { p1: { sortOrder: 0, draft: '所感', final: '所感' } };
		holder.chapters = [
			{
				id: 'ch1',
				title: '第一章',
				turns: [{ id: 't1', speakerType: 'persona', personaId: 'p1', content: '原本の発言' }]
			}
		];
		holder.editedByChapter = new Map([['ch1', { status: 'failed', turns: [] }]]);
		render(EditingPage);

		const button = page.getByRole('button', { name: '再生成' });
		await button.click();
		expect(holder.regenerateArticleElement).toHaveBeenCalledWith({
			kind: 'chapter',
			chapterId: 'ch1'
		});
	});

	it('編集が実行中（running）のあいだは未完成の明示・再生成ボタンを出さない（Req 3.2）', async () => {
		holder.phaseStatus = 'running';
		holder.intro = { draft: '導入の原本のみ', final: null };
		holder.impressions = {};
		render(EditingPage);

		expect(page.getByRole('button', { name: '再生成' }).elements()).toHaveLength(0);
		expect(page.getByText('原本のみ（未編集）').elements()).toHaveLength(0);
	});

	it('再生成の処理中は当該ボタンを無効化し重複実行を防ぐ（Req 4.8）', async () => {
		holder.intro = { draft: '導入の原本のみ', final: null };
		holder.outro = { draft: 'o', final: 'o' };
		holder.impressions = { p1: { sortOrder: 0, draft: '所感', final: '所感' } };
		// 解決しない Promise で処理中状態を維持する
		holder.regenerateArticleElement.mockReturnValue(new Promise(() => {}));
		render(EditingPage);

		const button = page.getByRole('button', { name: '再生成' });
		await button.click();
		await expect.element(page.getByRole('button', { name: '再生成中...' })).toBeDisabled();
	});

	it('討論が未完了のあいだは編集開始ボタンを出さず、ゲート文言を表示する', async () => {
		holder.phase = 'debate';
		holder.phaseStatus = 'running';
		render(EditingPage);

		await expect.element(page.getByText(/討論が完了すると編集を開始できます/)).toBeInTheDocument();
		expect(page.getByRole('button', { name: '編集を開始する' }).elements()).toHaveLength(0);
	});

	it('討論完了後は編集開始ボタンを表示する（ゲート解除）', async () => {
		holder.phase = 'debate';
		holder.phaseStatus = 'generated';
		render(EditingPage);

		await expect.element(page.getByRole('button', { name: '編集を開始する' })).toBeInTheDocument();
	});
});
