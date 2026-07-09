import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

type ElementStatus = 'pending' | 'generating' | 'editing' | 'finished';
type Narration = { status: ElementStatus; draft: string | null; final: string | null };
type Impression = {
	personaId: string;
	sortOrder: number;
	status: ElementStatus;
	draft: string | null;
	final: string | null;
};

const pending = (): Narration => ({ status: 'pending', draft: null, final: null });

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
		intro: { status: 'pending', draft: null, final: null } as Narration,
		outro: { status: 'pending', draft: null, final: null } as Narration,
		impressions: [] as Impression[]
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
		holder.intro = pending();
		holder.outro = pending();
		holder.impressions = [];
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

	const impression = (
		personaId: string,
		status: ElementStatus,
		draft: string | null,
		final: string | null,
		sortOrder = 0
	): Impression => ({ personaId, sortOrder, status, draft, final });

	it('記事を 導入 → 本体 → 締め → 所感 の順で表示する（編集後を final として表示）', async () => {
		holder.intro = { status: 'finished', draft: '導入原本', final: 'これは導入の編集後本文です' };
		holder.outro = { status: 'finished', draft: '締め原本', final: 'これは締めの編集後本文です' };
		holder.impressions = [impression('p1', 'finished', '所感原本', 'これは所感の編集後本文です')];
		completedChapterFixture();
		render(EditingPage);

		await expect.element(page.getByRole('heading', { name: '導入' })).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: '締め' })).toBeInTheDocument();
		await expect.element(page.getByRole('heading', { name: '所感' })).toBeInTheDocument();
		await expect.element(page.getByText('これは導入の編集後本文です')).toBeInTheDocument();
		await expect.element(page.getByText('これは所感の編集後本文です')).toBeInTheDocument();
	});

	it('完了・原本のみ（編集失敗）の導入に状態表示と再生成ボタンを出し、押下で intro を再生成する', async () => {
		// 対象を intro に絞るため他要素は進行中（スケルトン・再生成なし）にする。
		holder.intro = { status: 'finished', draft: '導入の原本のみ', final: null };
		holder.outro = pending();
		holder.impressions = [];
		render(EditingPage);

		await expect.element(page.getByText('編集失敗')).toBeInTheDocument();
		const button = page.getByRole('button', { name: '再生成' });
		await expect.element(button).toBeInTheDocument();
		await button.click();
		expect(holder.regenerateArticleElement).toHaveBeenCalledWith({ kind: 'intro' });
	});

	it('完了・空（生成失敗）の所感に「生成失敗」と再生成ボタンを出し、押下で impression を再生成する', async () => {
		holder.intro = pending();
		holder.outro = pending();
		// 終端スイープが未生成ペルソナに materialize した生成失敗エントリ
		holder.impressions = [impression('p1', 'finished', null, null)];
		render(EditingPage);

		await expect.element(page.getByText('生成失敗')).toBeInTheDocument();
		const button = page.getByRole('button', { name: '再生成' });
		await button.click();
		expect(holder.regenerateArticleElement).toHaveBeenCalledWith({
			kind: 'impression',
			personaId: 'p1'
		});
	});

	it('未生成ペルソナ（エントリ無し）の所感は生成待ちスケルトンで表示する（再生成なし・Req 6.2）', async () => {
		// 記事要素は全て進行中にして、エントリ無しの所感が pending 扱い（再生成なし）であることを見る。
		holder.intro = pending();
		holder.outro = pending();
		holder.impressions = []; // p1 はエントリ無し → pending フォールバック
		render(EditingPage);

		await expect.element(page.getByRole('heading', { name: '所感' })).toBeInTheDocument();
		expect(page.getByText('生成失敗').elements()).toHaveLength(0);
		expect(page.getByRole('button', { name: '再生成' }).elements()).toHaveLength(0);
	});

	it('編集確定後、失敗章に再生成ボタンを出し、押下で chapter を再生成する', async () => {
		// 対象を章に絞るため記事要素は進行中（スケルトン・再生成なし）にする。
		holder.intro = pending();
		holder.outro = pending();
		holder.impressions = [];
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

	it('進行中の要素（生成中）はスケルトン＋段階ラベルで、状態表示や再生成を出さない（Req 3.1, 3.2）', async () => {
		// run 全体の状態ではなく要素自身の status で判定する（実行中は要素が generating/editing）。
		holder.phaseStatus = 'running';
		holder.intro = { status: 'generating', draft: null, final: null };
		holder.outro = { status: 'editing', draft: '締め原本', final: null };
		holder.impressions = [impression('p1', 'generating', null, null)];
		render(EditingPage);

		expect(page.getByRole('button', { name: '再生成' }).elements()).toHaveLength(0);
		expect(page.getByText('編集失敗').elements()).toHaveLength(0);
		expect(page.getByText('生成失敗').elements()).toHaveLength(0);
		await expect.element(page.getByText('編集中')).toBeInTheDocument();
	});

	it('再生成の処理中は当該ボタンを無効化し重複実行を防ぐ（Req 4.8）', async () => {
		// 再生成ボタンを1つに絞るため、intro のみ完了・他は進行中（スケルトン）にする。
		holder.intro = { status: 'finished', draft: '導入の原本のみ', final: null };
		holder.outro = pending();
		holder.impressions = [impression('p1', 'generating', null, null)];
		// 解決しない Promise で処理中状態を維持する
		holder.regenerateArticleElement.mockReturnValue(new Promise(() => {}));
		render(EditingPage);

		const button = page.getByRole('button', { name: '再生成' });
		await button.click();
		// 処理中はローディング表示になり無効化される（アクセシブル名は保持される）。
		await expect.element(button).toBeDisabled();
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
