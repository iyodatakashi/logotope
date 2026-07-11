import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { EngagementHistoryEntryWithPersona } from '$lib/models/engagement/engagement.types';

// personaMap・engagementsMap は各コンポーネントが store から直接引くため、テストでも store をモックして注入する。
const { holder } = vi.hoisted(() => ({
	holder: {
		personaMap: new Map<string, { name: string }>(),
		engagementsMap: new Map<string, unknown[]>()
	}
}));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get personasStore() {
			return {
				get personaMap() {
					return holder.personaMap;
				}
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

import EngagementList from '$lib/features/admin/topic-detail/debate/EngagementList.svelte';

// エンゲージメント派生型は models に集約され、話者名は型に畳まず描画時に personaMap で解決する（Req 3.1/7.1）。
const entry = (
	personaId: string,
	mode: EngagementHistoryEntryWithPersona['mode'],
	score: number
): EngagementHistoryEntryWithPersona => ({ personaId, turnId: 't1', mode, score });

describe('EngagementList.svelte', () => {
	it('話者名は entry に畳まず personaMap から描画時に解決して「name: mode(score)」で出す', async () => {
		holder.personaMap = new Map([['p1', { name: '田中' }]]);
		holder.engagementsMap = new Map([['t1', [entry('p1', 'opinion', 4)]]]);
		render(EngagementList, { turnId: 't1' });
		await expect.element(page.getByText('田中: opinion(4)')).toBeInTheDocument();
	});

	it('personaMap を起点にループし、entry の無いペルソナは出さない（古い personaId の残骸を出さない）', async () => {
		holder.personaMap = new Map([
			['p1', { name: '田中' }],
			['p2', { name: '佐藤' }]
		]);
		holder.engagementsMap = new Map([['t1', [entry('p1', 'fact', 2)]]]);
		render(EngagementList, { turnId: 't1' });
		await expect.element(page.getByText('田中: fact(2)')).toBeInTheDocument();
		expect(page.getByText('佐藤', { exact: false }).elements()).toHaveLength(0);
	});

	it('選択中ペルソナには選択スタイル（--selected クラス）を付す', async () => {
		holder.personaMap = new Map([['p1', { name: '田中' }]]);
		holder.engagementsMap = new Map([['t1', [entry('p1', 'opinion', 3)]]]);
		render(EngagementList, { turnId: 't1', selectedPersonaId: 'p1' });
		await expect
			.element(page.getByText('田中: opinion(3)'))
			.toHaveClass('engagement-list__engagement--selected');
	});
});
