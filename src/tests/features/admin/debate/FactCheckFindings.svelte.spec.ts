import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FactCheckFindings from '$lib/features/admin/debate/FactCheckFindings.svelte';
import type { FactCheckFinding } from '$lib/models/factCheck/factCheck.types';

const incorrectFinding: FactCheckFinding = {
	id: 'f1',
	turnId: 't1',
	speakerType: 'persona',
	claim: '日本の人口は2億人である',
	verdict: 'incorrect',
	correction: '日本の人口は約1.2億人である',
	reason: '総務省統計局のデータと矛盾するため',
	sources: [{ title: '総務省統計局', url: 'https://stat.go.jp' }]
};

describe('FactCheckFindings.svelte', () => {
	it('incorrect は「事実と異なる」ラベルを表示する', async () => {
		render(FactCheckFindings, { findings: [incorrectFinding] });
		await expect.element(page.getByText('事実と異なる')).toBeInTheDocument();
	});

	it('誤り箇所（引用）・正しい事実・理由・出典を表示する', async () => {
		render(FactCheckFindings, { findings: [incorrectFinding] });
		await expect.element(page.getByText(/日本の人口は2億人である/)).toBeInTheDocument();
		await expect.element(page.getByText(/日本の人口は約1.2億人である/)).toBeInTheDocument();
		await expect.element(page.getByText(/総務省統計局のデータと矛盾するため/)).toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: /総務省統計局/ })).toBeInTheDocument();
	});

	it('検証不能の指摘は検証不能であることを示す', async () => {
		const unverifiable: FactCheckFinding = {
			...incorrectFinding,
			id: 'f2',
			verdict: 'unverifiable',
			correction: '',
			sources: []
		};
		render(FactCheckFindings, { findings: [unverifiable] });
		await expect.element(page.getByText(/検証不能/)).toBeInTheDocument();
	});

	it('指摘がなければ何も表示しない', async () => {
		render(FactCheckFindings, { findings: [] });
		expect(page.getByText(/正しい事実/).elements()).toHaveLength(0);
	});
});
