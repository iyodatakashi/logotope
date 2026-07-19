import { page } from 'vitest/browser';
import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StepNav from '$lib/features/admin/topic-detail/StepNav.svelte';

describe('StepNav.svelte', () => {
	it('ペルソナ生成ステップを単一フェーズ personas に対応させてグループラベルを表示する', async () => {
		render(StepNav, {
			topicId: 't1',
			currentPhase: 'personas',
			phaseStatus: 'not_started',
			published: false
		});

		await expect.element(page.getByText('テーマ設定')).toBeInTheDocument();
		await expect.element(page.getByText('事実リサーチ')).toBeInTheDocument();
		await expect.element(page.getByText('ペルソナ生成')).toBeInTheDocument();
		await expect.element(page.getByText('アジェンダ生成')).toBeInTheDocument();
		await expect.element(page.getByText('討論')).toBeInTheDocument();
		await expect.element(page.getByText('編集')).toBeInTheDocument();
		await expect.element(page.getByText('公開')).toBeInTheDocument();
	});

	it('公開フェーズでは公開ステップが末尾に表示される', async () => {
		render(StepNav, {
			topicId: 't1',
			currentPhase: 'publish',
			phaseStatus: 'not_started',
			published: false
		});

		await expect.element(page.getByText('公開')).toBeInTheDocument();
	});

	it('テーマ設定が先頭ステップで、未到達の事実リサーチはリンクにならない', async () => {
		const { unmount } = render(StepNav, {
			topicId: 't1',
			currentPhase: 'theme',
			phaseStatus: 'not_started',
			published: false
		});

		await expect
			.element(page.getByRole('link', { name: 'テーマ設定' }))
			.toHaveAttribute('href', '/admin/topics/t1/theme');
		expect(page.getByRole('link', { name: '事実リサーチ' }).elements()).toHaveLength(0);
		unmount();
	});

	it('現在フェーズを含むグループの href は現在フェーズを指す', async () => {
		render(StepNav, {
			topicId: 't1',
			currentPhase: 'personas',
			phaseStatus: 'not_started',
			published: false
		});

		await expect
			.element(page.getByRole('link', { name: 'テーマ設定' }))
			.toHaveAttribute('href', '/admin/topics/t1/theme');
		await expect
			.element(page.getByRole('link', { name: '事実リサーチ' }))
			.toHaveAttribute('href', '/admin/topics/t1/fact-research');
		// グループが現在フェーズ（personas）を含むので href は personas
		await expect
			.element(page.getByRole('link', { name: 'ペルソナ生成' }))
			.toHaveAttribute('href', '/admin/topics/t1/personas');
	});

	it('通過済みグループの href はグループのフェーズを指す', async () => {
		render(StepNav, {
			topicId: 't1',
			currentPhase: 'chapters',
			phaseStatus: 'not_started',
			published: false
		});

		await expect
			.element(page.getByRole('link', { name: 'ペルソナ生成' }))
			.toHaveAttribute('href', '/admin/topics/t1/personas');
	});

	it('未到達グループはリンクにならず無効化表示される', async () => {
		render(StepNav, {
			topicId: 't1',
			currentPhase: 'personas',
			phaseStatus: 'not_started',
			published: false
		});

		expect(page.getByRole('link', { name: 'アジェンダ生成' }).elements()).toHaveLength(0);
		expect(page.getByRole('link', { name: '討論' }).elements()).toHaveLength(0);
		expect(page.getByRole('link', { name: '編集' }).elements()).toHaveLength(0);
	});

	it('personas の URL でペルソナ生成ステップがアクティブになる', async () => {
		const { unmount } = render(StepNav, {
			topicId: 't1',
			currentPhase: 'personas',
			phaseStatus: 'not_started',
			published: false,
			currentPath: '/admin/topics/t1/personas'
		});
		await expect
			.element(page.getByRole('link', { name: 'ペルソナ生成' }))
			.toHaveAttribute('aria-current', 'step');
		unmount();
	});
});

describe('StepNav.svelte progress { step, status } 導出', () => {
	// ステップラベルから所属する step 要素（step-nav__step）の class を取り、状態クラスを検証する。
	const stepClassOf = (label: string): string =>
		(page.getByText(label).element().closest('.step-nav__step')?.className ?? '') as string;

	it('中間フェーズが generated のとき現在ステップが done になる', async () => {
		const { unmount } = render(StepNav, {
			topicId: 't1',
			currentPhase: 'fact-research',
			phaseStatus: 'generated',
			published: false
		});

		await expect.element(page.getByText('事実リサーチ')).toBeInTheDocument();
		expect(stepClassOf('事実リサーチ')).toContain('step-nav__step--done');
		unmount();
	});

	it('前進済みの手前フェーズは completed（done）になる', async () => {
		const { unmount } = render(StepNav, {
			topicId: 't1',
			currentPhase: 'personas',
			phaseStatus: 'not_started',
			published: false
		});

		await expect.element(page.getByText('テーマ設定')).toBeInTheDocument();
		expect(stepClassOf('テーマ設定')).toContain('step-nav__step--done');
		// 現在フェーズ（ペルソナ生成）は未完了（in-progress）。
		expect(stepClassOf('ペルソナ生成')).toContain('step-nav__step--in-progress');
		unmount();
	});

	it('publish かつ published=true のとき公開ステップが done になる', async () => {
		const { unmount } = render(StepNav, {
			topicId: 't1',
			currentPhase: 'publish',
			phaseStatus: 'not_started',
			published: true
		});

		await expect.element(page.getByText('公開')).toBeInTheDocument();
		expect(stepClassOf('公開')).toContain('step-nav__step--done');
		unmount();
	});

	it('publish かつ published=false のとき公開ステップは in-progress（未完了）になる', async () => {
		const { unmount } = render(StepNav, {
			topicId: 't1',
			currentPhase: 'publish',
			phaseStatus: 'not_started',
			published: false
		});

		await expect.element(page.getByText('公開')).toBeInTheDocument();
		expect(stepClassOf('公開')).toContain('step-nav__step--in-progress');
		unmount();
	});
});
