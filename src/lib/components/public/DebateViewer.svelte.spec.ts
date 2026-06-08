import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DebateViewer from './DebateViewer.svelte';
import type { PublishedDebateDetail } from '$lib/types/index.js';

const debate: PublishedDebateDetail = {
	id: 'session-1',
	topicTitle: '消費税増税について',
	personas: [
		{
			id: 'p-1',
			name: '田中太郎',
			role: '中小企業経営者',
			beliefHistory: [{ version: 0, content: '反対です' }]
		},
		{
			id: 'p-2',
			name: '鈴木花子',
			role: '消費者代表',
			beliefHistory: [{ version: 0, content: '条件付き賛成' }]
		}
	],
	turns: [
		{
			id: 'turn-0',
			turnIndex: 0,
			speakerType: 'facilitator',
			speakerName: 'ファシリテーター',
			speakerRole: '',
			content: 'では始めましょう。',
			beliefChangesTriggered: []
		},
		{
			id: 'turn-1',
			turnIndex: 1,
			speakerType: 'persona',
			speakerName: '田中太郎',
			speakerRole: '中小企業経営者',
			content: '反対です。',
			beliefChangesTriggered: []
		},
		{
			id: 'turn-2',
			turnIndex: 2,
			speakerType: 'persona',
			speakerName: '鈴木花子',
			speakerRole: '消費者代表',
			content: '賛成です。',
			beliefChangesTriggered: []
		}
	],
	postDebateComments: []
};

describe('DebateViewer.svelte', () => {
	it('全ターンをデフォルトで表示する', async () => {
		render(DebateViewer, { debate });
		await expect.element(page.getByText('では始めましょう。')).toBeInTheDocument();
		await expect.element(page.getByText('反対です。')).toBeInTheDocument();
		await expect.element(page.getByText('賛成です。')).toBeInTheDocument();
	});

	it('ペルソナ一覧をフィルターボタンとして表示する', async () => {
		render(DebateViewer, { debate });
		await expect.element(page.getByRole('button', { name: '田中太郎' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '鈴木花子' })).toBeInTheDocument();
	});

	it('ペルソナフィルター選択時は該当ペルソナの発言のみ表示する', async () => {
		render(DebateViewer, { debate, selectedPersonaId: 'p-1' });
		await expect.element(page.getByText('反対です。')).toBeInTheDocument();
		const suzukiTurn = page.getByText('賛成です。');
		await expect.element(suzukiTurn).not.toBeInTheDocument();
	});
});
