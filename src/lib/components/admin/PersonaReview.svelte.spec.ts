import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PersonaReview from './PersonaReview.svelte';

const mockPersonas = [
	{
		id: 'p1', name: '田中太郎', stakeholderRole: '市民', age: 42,
		occupation: '会社員', background: '東京在住', stanceDirection: 'neutral'
	},
	{
		id: 'p2', name: '鈴木花子', stakeholderRole: 'IT企業', age: 35,
		occupation: 'エンジニア', background: '起業経験あり', stanceDirection: 'for'
	}
];

describe('PersonaReview.svelte', () => {
	it('renders persona names and roles', async () => {
		render(PersonaReview, { personas: mockPersonas, onApprove: vi.fn(), onReject: vi.fn() });

		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
		await expect.element(page.getByText('鈴木花子')).toBeInTheDocument();
		await expect.element(page.getByText('市民')).toBeInTheDocument();
	});

	it('renders persona attributes', async () => {
		render(PersonaReview, { personas: mockPersonas, onApprove: vi.fn(), onReject: vi.fn() });

		await expect.element(page.getByText('42歳')).toBeInTheDocument();
		await expect.element(page.getByText('会社員')).toBeInTheDocument();
	});

	it('renders approve and reject buttons', async () => {
		render(PersonaReview, { personas: mockPersonas, onApprove: vi.fn(), onReject: vi.fn() });

		await expect.element(page.getByRole('button', { name: '承認して取材開始' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '差し戻し' })).toBeInTheDocument();
	});

	it('calls onApprove when approve clicked', async () => {
		const onApprove = vi.fn();
		render(PersonaReview, { personas: mockPersonas, onApprove, onReject: vi.fn() });

		await page.getByRole('button', { name: '承認して取材開始' }).click();

		expect(onApprove).toHaveBeenCalledOnce();
	});
});
