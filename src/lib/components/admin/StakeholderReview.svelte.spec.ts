import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StakeholderReview from './StakeholderReview.svelte';

const mockStakeholders = [
	{ id: 's1', role: '市民', stanceDirection: 'neutral', minorityLevel: 'low', rationale: '日常的な影響を受ける一般市民' },
	{ id: 's2', role: 'IT企業', stanceDirection: 'for', minorityLevel: 'medium', rationale: 'ビジネス機会として活用' }
];

describe('StakeholderReview.svelte', () => {
	it('renders stakeholder roles and rationale', async () => {
		render(StakeholderReview, { stakeholders: mockStakeholders, onApprove: vi.fn(), onReject: vi.fn() });

		await expect.element(page.getByText('市民', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('IT企業', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('日常的な影響を受ける一般市民')).toBeInTheDocument();
	});

	it('shows stance and minority level badges', async () => {
		render(StakeholderReview, { stakeholders: mockStakeholders, onApprove: vi.fn(), onReject: vi.fn() });

		await expect.element(page.getByText('neutral')).toBeInTheDocument();
		await expect.element(page.getByText('low')).toBeInTheDocument();
	});

	it('renders approve and reject buttons', async () => {
		render(StakeholderReview, { stakeholders: mockStakeholders, onApprove: vi.fn(), onReject: vi.fn() });

		await expect.element(page.getByRole('button', { name: '承認' })).toBeInTheDocument();
		await expect.element(page.getByRole('button', { name: '差し戻し' })).toBeInTheDocument();
	});

	it('calls onApprove when approve button clicked', async () => {
		const onApprove = vi.fn();
		render(StakeholderReview, { stakeholders: mockStakeholders, onApprove, onReject: vi.fn() });

		await page.getByRole('button', { name: '承認' }).click();

		expect(onApprove).toHaveBeenCalledOnce();
	});

	it('calls onReject when reject button clicked', async () => {
		const onReject = vi.fn();
		render(StakeholderReview, { stakeholders: mockStakeholders, onApprove: vi.fn(), onReject });

		await page.getByRole('button', { name: '差し戻し' }).click();

		expect(onReject).toHaveBeenCalledOnce();
	});
});
