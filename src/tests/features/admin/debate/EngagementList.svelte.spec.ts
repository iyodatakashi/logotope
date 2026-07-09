import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EngagementList from '$lib/features/admin/topic-detail/debate/EngagementList.svelte';
import type { EngagementHistoryEntryWithPersona } from '$lib/models/engagement/engagement.types';

// エンゲージメント派生型は models に集約され、話者名は型に畳まず描画時に personaMap で解決する（Req 3.1/7.1）。
const entry = (
	personaId: string,
	mode: EngagementHistoryEntryWithPersona['mode'],
	score: number
): EngagementHistoryEntryWithPersona => ({ personaId, turnId: 't1', mode, score });

describe('EngagementList.svelte', () => {
	it('話者名は entry に畳まず personaMap から描画時に解決して「name: mode(score)」で出す', async () => {
		const engagements = [entry('p1', 'opinion', 4)];
		const personaMap = new Map([['p1', { name: '田中' }]]);
		render(EngagementList, { engagements, personaMap });
		await expect.element(page.getByText('田中: opinion(4)')).toBeInTheDocument();
	});

	it('personaMap を起点にループし、entry の無いペルソナは出さない（古い personaId の残骸を出さない）', async () => {
		const engagements = [entry('p1', 'fact', 2)];
		const personaMap = new Map([
			['p1', { name: '田中' }],
			['p2', { name: '佐藤' }]
		]);
		render(EngagementList, { engagements, personaMap });
		await expect.element(page.getByText('田中: fact(2)')).toBeInTheDocument();
		expect(page.getByText('佐藤', { exact: false }).elements()).toHaveLength(0);
	});

	it('選択中ペルソナには「→選択」を付す', async () => {
		const engagements = [entry('p1', 'opinion', 3)];
		const personaMap = new Map([['p1', { name: '田中' }]]);
		render(EngagementList, { engagements, personaMap, selectedPersonaId: 'p1' });
		await expect.element(page.getByText('→選択')).toBeInTheDocument();
	});
});
