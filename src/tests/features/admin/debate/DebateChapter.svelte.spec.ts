import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Turn } from '$lib/models/turn/turn.types';
import type { Chapter } from '$lib/models/chapter/chapter.types';
import type { Persona } from '$lib/models/persona/persona.types';
import type { EngagementHistoryEntryWithPersona } from '$lib/models/engagement/engagement.types';

// 話者ラベル・気づき話者名・エンゲージメントは型に畳まず、各コンポーネントが store から描画時に解決する。
const { holder } = vi.hoisted(() => ({
	holder: {
		personaMap: new Map<string, unknown>(),
		engagementsMap: new Map<string, unknown[]>(),
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
		},
		get engagementsStore() {
			return {
				get engagementsMap() {
					return holder.engagementsMap;
				}
			};
		}
	}
}));

import DebateChapter from '$lib/features/admin/topic-detail/debate/DebateChapter.svelte';

const turn = (overrides: Partial<Turn> = {}): Turn =>
	({
		id: 't1',
		speakerType: 'persona',
		personaId: 'p1',
		content: '発言本文',
		createdAt: new Date(),
		...overrides
	}) as Turn;

const persona = (partial: Partial<Persona>): Persona => partial as unknown as Persona;

const chapter = (overrides: Partial<Chapter> = {}): Chapter =>
	({
		id: 'ch1',
		chapterIndex: 0,
		title: 'テスト章',
		agenda: [],
		status: 'running',
		turns: [turn()],
		...overrides
	}) as Chapter;

const setStore = (overrides: Partial<typeof holder> = {}) => {
	holder.personaMap = overrides.personaMap ?? new Map([['p1', persona({ id: 'p1', name: '田中', specificRole: '医師' })]]);
	holder.engagementsMap = overrides.engagementsMap ?? new Map();
	holder.awarenessesByTurn = overrides.awarenessesByTurn ?? new Map();
};

describe('DebateChapter.svelte', () => {
	it('章タイトルとターン本文を出す', async () => {
		setStore();
		render(DebateChapter, { chapter: chapter() });
		await expect.element(page.getByText('テスト章')).toBeInTheDocument();
		await expect.element(page.getByText('発言本文')).toBeInTheDocument();
	});

	it('話者名・役割は型に畳まず personaMap から描画時に解決する', async () => {
		setStore();
		render(DebateChapter, { chapter: chapter() });
		await expect.element(page.getByText('田中')).toBeInTheDocument();
		await expect.element(page.getByText('(医師)')).toBeInTheDocument();
	});

	it('指名先（targetPersonaId）を「次の指名」として personaMap から解決して出す', async () => {
		setStore({
			personaMap: new Map([
				['p1', persona({ id: 'p1', name: '田中' })],
				['p2', persona({ id: 'p2', name: '鈴木' })]
			])
		});
		render(DebateChapter, { chapter: chapter({ turns: [turn({ targetPersonaId: 'p2' })] }) });
		await expect.element(page.getByText(/次の指名: 鈴木/)).toBeInTheDocument();
	});

	it('気づきは由来ターンidで引き、話者名は personaMap で解決する', async () => {
		setStore({
			awarenessesByTurn: new Map([['t1', [{ personaId: 'p1', content: '視点が変わった' }]]])
		});
		render(DebateChapter, { chapter: chapter() });
		await expect.element(page.getByText('💡 田中: 視点が変わった')).toBeInTheDocument();
	});

	it('エンゲージメントを EngagementList 経由で表示する', async () => {
		setStore({
			personaMap: new Map([
				['p1', persona({ id: 'p1', name: '田中' })],
				['p2', persona({ id: 'p2', name: '鈴木' })]
			]),
			engagementsMap: new Map<string, EngagementHistoryEntryWithPersona[]>([
				['t1', [{ turnId: 't1', personaId: 'p2', score: 4, mode: 'opinion' }]]
			])
		});
		render(DebateChapter, { chapter: chapter() });
		await expect.element(page.getByText('鈴木: opinion(4)')).toBeInTheDocument();
	});

	it('生成中ターン（pendingTurn）を段階ラベル付きスケルトンとして確定ターンの後に出す', async () => {
		setStore({
			personaMap: new Map([
				['p1', persona({ id: 'p1', name: '田中' })],
				['p2', persona({ id: 'p2', name: '鈴木' })]
			])
		});
		render(DebateChapter, {
			chapter: chapter({
				pendingTurn: { id: 'pt1', personaId: 'p2', expectedTurnIndex: 1, status: 'generating' }
			})
		});
		await expect.element(page.getByText('鈴木')).toBeInTheDocument();
		await expect.element(page.getByText('発言を生成中…')).toBeInTheDocument();
	});

	it('personaId なしの pendingTurn は「ファシリテーター」としてスケルトンを出す', async () => {
		setStore();
		render(DebateChapter, {
			chapter: chapter({
				pendingTurn: { id: 'pt-fac', expectedTurnIndex: 1, status: 'generating' }
			})
		});
		await expect.element(page.getByText('ファシリテーター')).toBeInTheDocument();
		await expect.element(page.getByText('発言を生成中…')).toBeInTheDocument();
	});

	it('確定ターンが評価中（status=evaluating）で気づき未検出なら反応スケルトンを出す', async () => {
		setStore({
			personaMap: new Map([
				['p1', persona({ id: 'p1', name: '田中' })],
				['p2', persona({ id: 'p2', name: '鈴木' })]
			])
		});
		// 話者 p1 のターンが評価中 → 反応する p2 の分のスケルトンが出る
		render(DebateChapter, {
			chapter: chapter({ turns: [turn({ status: 'evaluating' })] })
		});
		await expect.element(page.getByTestId('engagement-skeleton')).toBeInTheDocument();
	});
});
