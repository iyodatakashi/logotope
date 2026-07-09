import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DebateChapter from '$lib/features/admin/topic-detail/debate/DebateChapter.svelte';
import type { Turn } from '$lib/models/turn/turn.types';
import type { Persona } from '$lib/models/persona/persona.types';
import type { EngagementHistoryEntryWithPersona } from '$lib/models/engagement/engagement.types';

// 話者ラベル・気づき話者名は型に畳まず personaMap から描画時に解決する（Turn と同じ責務境界）。
const turn = (overrides: Partial<Turn> = {}): Turn =>
	({
		id: 't1',
		speakerType: 'persona',
		personaId: 'p1',
		content: '発言本文',
		createdAt: new Date(),
		...overrides
	}) as Turn;

const makeProps = (overrides: Record<string, unknown> = {}) => ({
	title: 'テスト章',
	turns: [turn()],
	personaMap: new Map<string, Persona>([
		['p1', { id: 'p1', name: '田中', specificRole: '医師' } as unknown as Persona]
	]),
	engagementsMap: new Map<string, EngagementHistoryEntryWithPersona[]>(),
	awarenessesByTurn: new Map<string, { personaId: string; content: string }[]>(),
	...overrides
});

describe('DebateChapter.svelte', () => {
	it('章タイトルとターン本文を出す', async () => {
		render(DebateChapter, makeProps());
		await expect.element(page.getByText('テスト章')).toBeInTheDocument();
		await expect.element(page.getByText('発言本文')).toBeInTheDocument();
	});

	it('話者名・役割は型に畳まず personaMap から描画時に解決する', async () => {
		render(DebateChapter, makeProps());
		await expect.element(page.getByText('田中')).toBeInTheDocument();
		await expect.element(page.getByText('(医師)')).toBeInTheDocument();
	});

	it('指名先（targetPersonaId）を「次の指名」として personaMap から解決して出す', async () => {
		const personaMap = new Map<string, Persona>([
			['p1', { id: 'p1', name: '田中' } as unknown as Persona],
			['p2', { id: 'p2', name: '鈴木' } as unknown as Persona]
		]);
		render(
			DebateChapter,
			makeProps({ turns: [turn({ targetPersonaId: 'p2' })], personaMap })
		);
		await expect.element(page.getByText(/次の指名: 鈴木/)).toBeInTheDocument();
	});

	it('気づきは由来ターンidで引き、話者名は personaMap で解決する', async () => {
		const awarenessesByTurn = new Map([['t1', [{ personaId: 'p1', content: '視点が変わった' }]]]);
		render(DebateChapter, makeProps({ awarenessesByTurn }));
		await expect.element(page.getByText('💡 田中: 視点が変わった')).toBeInTheDocument();
	});

	it('エンゲージメントを EngagementList 経由で表示する', async () => {
		const personaMap = new Map<string, Persona>([
			['p1', { id: 'p1', name: '田中' } as unknown as Persona],
			['p2', { id: 'p2', name: '鈴木' } as unknown as Persona]
		]);
		const engagementsMap = new Map<string, EngagementHistoryEntryWithPersona[]>([
			['t1', [{ turnId: 't1', personaId: 'p2', score: 4, mode: 'opinion' }]]
		]);
		render(DebateChapter, makeProps({ personaMap, engagementsMap }));
		await expect.element(page.getByText('鈴木: opinion(4)')).toBeInTheDocument();
	});
});
