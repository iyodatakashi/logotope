import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import DebatePreview from './DebatePreview.svelte';

const mockTurns = [
	{
		id: 't1', turnIndex: 0, speakerType: 'facilitator', speakerName: 'ファシリテーター',
		speakerRole: '', content: 'それではディスカッションを始めます。', beliefChangesTriggered: []
	},
	{
		id: 't2', turnIndex: 1, speakerType: 'persona', speakerName: '田中太郎',
		speakerRole: '市民', content: '私はAI規制に賛成です。', beliefChangesTriggered: []
	},
	{
		id: 't3', turnIndex: 2, speakerType: 'persona', speakerName: '鈴木花子',
		speakerRole: 'IT企業', content: '規制は慎重に。',
		beliefChangesTriggered: [{ personaId: 'p2', personaName: '鈴木花子', changeType: 'partial_acceptance', changeSummary: '一部受容' }]
	}
];

describe('DebatePreview.svelte', () => {
	it('renders all turns in order', async () => {
		render(DebatePreview, { turns: mockTurns, onPublish: vi.fn() });

		await expect.element(page.getByText('それではディスカッションを始めます。')).toBeInTheDocument();
		await expect.element(page.getByText('私はAI規制に賛成です。')).toBeInTheDocument();
		await expect.element(page.getByText('規制は慎重に。')).toBeInTheDocument();
	});

	it('shows speaker name and role for each turn', async () => {
		render(DebatePreview, { turns: mockTurns, onPublish: vi.fn() });

		await expect.element(page.getByText('ファシリテーター')).toBeInTheDocument();
		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
	});

	it('shows belief change badge when beliefChangesTriggered is non-empty', async () => {
		render(DebatePreview, { turns: mockTurns, onPublish: vi.fn() });

		await expect.element(page.getByText('信念変化')).toBeInTheDocument();
	});

	it('renders publish button', async () => {
		render(DebatePreview, { turns: mockTurns, onPublish: vi.fn() });

		await expect.element(page.getByRole('button', { name: '公開する' })).toBeInTheDocument();
	});

	it('calls onPublish when publish button clicked', async () => {
		const onPublish = vi.fn();
		render(DebatePreview, { turns: mockTurns, onPublish });

		await page.getByRole('button', { name: '公開する' }).click();

		expect(onPublish).toHaveBeenCalledOnce();
	});

	it('shows published URL when publishUrl is provided', async () => {
		render(DebatePreview, { turns: mockTurns, onPublish: vi.fn(), publishUrl: '/debate/abc123' });

		await expect.element(page.getByText('/debate/abc123')).toBeInTheDocument();
	});
});
