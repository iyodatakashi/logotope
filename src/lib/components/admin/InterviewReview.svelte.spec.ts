import { page } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import InterviewReview from './InterviewReview.svelte';

const mockInterviews = [
	{ personaId: 'p1', personaName: '田中太郎', interviewRecord: '取材記録の内容...', status: 'completed' },
	{ personaId: 'p2', personaName: '鈴木花子', interviewRecord: '取材記録その2...', status: 'completed' }
];

describe('InterviewReview.svelte', () => {
	it('renders persona names and interview records', async () => {
		render(InterviewReview, { interviews: mockInterviews, onApprove: vi.fn() });

		await expect.element(page.getByText('田中太郎')).toBeInTheDocument();
		await expect.element(page.getByText('鈴木花子')).toBeInTheDocument();
		await expect.element(page.getByText('取材記録の内容...')).toBeInTheDocument();
	});

	it('renders approve button', async () => {
		render(InterviewReview, { interviews: mockInterviews, onApprove: vi.fn() });

		await expect.element(page.getByRole('button', { name: '承認して討論を開始' })).toBeInTheDocument();
	});

	it('calls onApprove when approve clicked', async () => {
		const onApprove = vi.fn();
		render(InterviewReview, { interviews: mockInterviews, onApprove });

		await page.getByRole('button', { name: '承認して討論を開始' }).click();

		expect(onApprove).toHaveBeenCalledOnce();
	});

	it('shows error persona with retry button when status is error', async () => {
		const interviews = [
			{ personaId: 'p1', personaName: '田中太郎', interviewRecord: '', status: 'error' }
		];
		render(InterviewReview, { interviews, onApprove: vi.fn(), onRetry: vi.fn() });

		await expect.element(page.getByRole('button', { name: '再試行' })).toBeInTheDocument();
	});
});
