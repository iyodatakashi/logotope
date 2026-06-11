import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import BeliefEvolution from '$lib/features/admin/debate/BeliefEvolution.svelte';
import type { PersonaSummaryForViewer } from '$lib/models/persona/persona.types.js';
import type { PublishedTurn } from '$lib/models/session/session.types.js';

const persona: PersonaSummaryForViewer = {
	id: 'p-1',
	name: '田中太郎',
	role: '中小企業経営者',
	beliefHistory: [
		{ version: 0, content: '消費税増税に強く反対する。' },
		{
			version: 1,
			content: '一定条件下なら受け入れられる。',
			changeType: 'partial_acceptance',
			changeSummary: '補助金制度の説明を受けて軟化',
			triggeredByTurnId: 'turn-5'
		}
	]
};

const turns: PublishedTurn[] = [
	{
		id: 'turn-5',
		turnIndex: 5,
		speakerType: 'persona',
		speakerName: '鈴木花子',
		speakerRole: '消費者代表',
		content: '補助金制度があれば緩和されます。',
		beliefChangesTriggered: []
	}
];

describe('BeliefEvolution.svelte', () => {
	it('ペルソナ名を表示する', async () => {
		render(BeliefEvolution, { persona, turns });
		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
	});

	it('初期信念セクションを表示する', async () => {
		render(BeliefEvolution, { persona, turns });
		await expect.element(page.getByText('消費税増税に強く反対する。')).toBeInTheDocument();
	});

	it('信念変化があった場合に変化サマリーを表示する', async () => {
		render(BeliefEvolution, { persona, turns });
		await expect.element(page.getByText('補助金制度の説明を受けて軟化')).toBeInTheDocument();
	});

	it('信念変化がないとき変化リストを表示しない', async () => {
		const noChanges: PersonaSummaryForViewer = {
			...persona,
			beliefHistory: [persona.beliefHistory[0]]
		};
		render(BeliefEvolution, { persona: noChanges, turns });
		const changeList = page.getByTestId('belief-change-list');
		await expect.element(changeList).not.toBeInTheDocument();
	});
});
