import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TurnDisplay from '$lib/features/topics/detail/TurnDisplay.svelte';

const personaTurn = {
	id: 'turn-1',
	turnIndex: 1,
	speakerType: 'persona' as const,
	speakerName: '田中太郎',
	speakerRole: '中小企業経営者',
	content: '消費税が上がると経営が苦しくなります。',
	beliefChangesTriggered: []
};

const facilitatorTurn = {
	id: 'turn-0',
	turnIndex: 0,
	speakerType: 'facilitator' as const,
	speakerName: 'ファシリテーター',
	speakerRole: '',
	content: 'では始めましょう。',
	beliefChangesTriggered: []
};

const turnWithBeliefChange = {
	...personaTurn,
	id: 'turn-2',
	beliefChangesTriggered: [
		{
			personaId: 'p-1',
			personaName: '鈴木花子',
			changeType: 'partial_acceptance' as const,
			changeSummary: '一部の主張を受け入れた'
		}
	]
};

describe('TurnDisplay.svelte', () => {
	it('発言者名を表示する', async () => {
		render(TurnDisplay, { turn: personaTurn });
		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
	});

	it('発言者の立場ラベルを表示する', async () => {
		render(TurnDisplay, { turn: personaTurn });
		await expect.element(page.getByText('中小企業経営者')).toBeInTheDocument();
	});

	it('発言内容を表示する', async () => {
		render(TurnDisplay, { turn: personaTurn });
		await expect
			.element(page.getByText('消費税が上がると経営が苦しくなります。'))
			.toBeInTheDocument();
	});

	it('ファシリテーターターンに専用スタイルを適用する', async () => {
		render(TurnDisplay, { turn: facilitatorTurn });
		await expect.element(page.getByText('ファシリテーター')).toBeInTheDocument();
	});

	it('信念変化がある場合にマーカーを表示する', async () => {
		render(TurnDisplay, { turn: turnWithBeliefChange });
		await expect.element(page.getByText(/鈴木花子/)).toBeInTheDocument();
	});

	it('信念変化がない場合はマーカーを表示しない', async () => {
		render(TurnDisplay, { turn: personaTurn });
		const markers = page.getByTestId('belief-change-marker');
		await expect.element(markers).not.toBeInTheDocument();
	});
});
