import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { EditedChapterDisplayStatus } from '$lib/models/chapter/chapter.types';
import type { Turn, TurnForEditing } from '$lib/models/turn/turn.types';
import type { Persona } from '$lib/models/persona/persona.types';

// personaMap・気づきは各コンポーネントが store から直接引くため、テストでも store をモックして注入する。
const { holder } = vi.hoisted(() => ({
	holder: {
		personaMap: new Map<string, unknown>(),
		awarenessesByTurn: new Map<string, { personaId: string; content: string }[]>()
	}
}));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get personasStore() {
			return {
				get personaMap() {
					return holder.personaMap;
				},
				getAwarenessesByTurn: (turnId: string) => holder.awarenessesByTurn.get(turnId) ?? []
			};
		}
	}
}));

import ChapterSection from '$lib/features/admin/topic-detail/editing/ChapterSection.svelte';

// TurnForEditing は EditedTurn & { removed }。話者ラベル・差分・気づきは型に持たず描画時に解決する。
const turn = (overrides: Partial<TurnForEditing> = {}): TurnForEditing => ({
	id: 't1',
	sourceTurnIds: ['t1'],
	speakerType: 'persona',
	personaId: 'p1',
	content: '原本の発言',
	removed: false,
	...overrides
});

const persona = (partial: Partial<Persona>): Persona => partial as unknown as Persona;

const makeProps = (overrides: Record<string, unknown> = {}) => ({
	title: '第一章',
	status: 'completed' as EditedChapterDisplayStatus,
	failureReason: null,
	showRegenerate: false,
	turns: [turn()],
	sourceTurns: [] as Turn[], // 差分の由来テキスト参照用（showDiff 時のみ使う）
	showDiff: false,
	onRegenerate: vi.fn(),
	...overrides
});

const setStore = (overrides: Partial<typeof holder> = {}) => {
	holder.personaMap = overrides.personaMap ?? new Map();
	holder.awarenessesByTurn = overrides.awarenessesByTurn ?? new Map();
};

const regenerate = () => page.getByRole('button', { name: '再生成' });

describe('ChapterSection.svelte', () => {
	it('章タイトルとステータスラベル（編集済み/原本表示（失敗）/未編集）を出す', async () => {
		setStore();
		render(ChapterSection, makeProps({ status: 'completed' }));
		await expect.element(page.getByText('第一章')).toBeInTheDocument();
		await expect.element(page.getByText('編集済み')).toBeInTheDocument();
	});

	it('失敗章は「原本表示（失敗）」と検証不合格の理由を出す', async () => {
		setStore();
		render(
			ChapterSection,
			makeProps({ status: 'failed', failureReason: '原本に存在しない sourceTurnId: ghost' })
		);
		await expect.element(page.getByText('原本表示（失敗）')).toBeInTheDocument();
		await expect.element(page.getByText(/検証不合格.*ghost/)).toBeInTheDocument();
	});

	it('未編集章は原本ターンをそのまま出す', async () => {
		setStore();
		render(ChapterSection, makeProps({ status: 'missing' }));
		await expect.element(page.getByText('未編集')).toBeInTheDocument();
		await expect.element(page.getByText('原本の発言')).toBeInTheDocument();
	});

	it('showRegenerate=false では再生成ボタンを出さない', async () => {
		setStore();
		render(ChapterSection, makeProps({ showRegenerate: false }));
		expect(regenerate().elements()).toHaveLength(0);
	});

	it('showRegenerate=true で押下すると onRegenerate を呼び、処理中は無効化する（ローディング自持ち）', async () => {
		setStore();
		let resolve!: () => void;
		const onRegenerate = vi.fn(() => new Promise<void>((r) => (resolve = r)));
		render(ChapterSection, makeProps({ status: 'failed', showRegenerate: true, onRegenerate }));

		const button = regenerate();
		await button.click();
		expect(onRegenerate).toHaveBeenCalledOnce();
		await expect.element(button).toBeDisabled();

		resolve();
		await expect.element(button).toBeEnabled();
	});

	it('削除ターンは差分表示オン時のみ「発言ごと削除」で出す', async () => {
		setStore();
		const removed = turn({ id: 'r1', content: '削除された発言', removed: true });
		render(ChapterSection, makeProps({ turns: [removed], showDiff: true }));
		await expect.element(page.getByText('発言ごと削除')).toBeInTheDocument();
		await expect.element(page.getByText('削除された発言')).toBeInTheDocument();
	});

	it('気づきは型に畳まず、由来原本id（sourceTurnIds）で store から参照し話者名は personaMap で解決する', async () => {
		// 編集後（連結）ターン: 行の id は新id、気づきは由来原本id で引き、話者名は personaId から描画時解決する
		const merged = turn({ id: 'edited-1', sourceTurnIds: ['src-a', 'src-b'] });
		setStore({
			awarenessesByTurn: new Map([['src-b', [{ personaId: 'p-sato', content: '視点が変わった' }]]]),
			personaMap: new Map([['p-sato', persona({ id: 'p-sato', name: '佐藤' })]])
		});
		render(ChapterSection, makeProps({ turns: [merged] }));
		await expect.element(page.getByText('💡 佐藤: 視点が変わった')).toBeInTheDocument();
	});

	it('差分は型に持たず、描画時に原本テキスト（sourceTurns）と編集後を比較して算出する', async () => {
		setStore();
		const edited = turn({ id: 'e1', sourceTurnIds: ['s1'], content: 'アイウエオカキク' });
		const sourceTurns = [{ id: 's1', content: 'アイウエオ' }] as unknown as Turn[];
		render(ChapterSection, makeProps({ turns: [edited], sourceTurns, showDiff: true }));
		// 追加分（カキク）が差分として表示される
		await expect.element(page.getByText('カキク')).toBeInTheDocument();
	});

	it('話者名は型に持たず personaMap から描画時に解決する', async () => {
		setStore({
			personaMap: new Map([['p1', persona({ id: 'p1', name: '田中', specificRole: '住民' })]])
		});
		render(ChapterSection, makeProps({ turns: [turn({ personaId: 'p1' })] }));
		await expect.element(page.getByText('田中')).toBeInTheDocument();
		await expect.element(page.getByText('(住民)')).toBeInTheDocument();
	});
});
