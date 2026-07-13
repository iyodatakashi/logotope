import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

let unmount: (() => void) | undefined;
const mount = () => {
	const result = render(PersonaWorkspacePage);
	unmount = result.unmount;
	return result;
};

const { goto, spies, state } = vi.hoisted(() => ({
	goto: vi.fn(),
	spies: {
		generateStakeholders: vi.fn(),
		generatePersonas: vi.fn(),
		resetPersonas: vi.fn(),
		resetChapters: vi.fn(),
		resetDebate: vi.fn(),
		resetEditing: vi.fn(),
		approveInterviews: vi.fn(),
		approvePersonas: vi.fn(),
		runInterviews: vi.fn(),
		setSelected: vi.fn()
	},
	state: {
		phase: 'stakeholders' as string,
		phaseStatus: 'generated' as string,
		stakeholders: [] as unknown[],
		personas: [] as unknown[]
	}
}));

vi.mock('$app/navigation', () => ({ goto }));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			return {
				id: 't1',
				title: 'テストテーマ',
				get phase() {
					return state.phase;
				},
				get phaseStatus() {
					return state.phaseStatus;
				},
				generateStakeholders: spies.generateStakeholders,
				generatePersonas: spies.generatePersonas,
				resetStakeholders: vi.fn(),
				resetPersonas: spies.resetPersonas,
				resetChapters: spies.resetChapters,
				resetDebate: spies.resetDebate,
				resetEditing: spies.resetEditing,
				approveInterviews: spies.approveInterviews
			};
		},
		get stakeholdersStore() {
			return {
				get stakeholders() {
					return state.stakeholders;
				},
				setSelected: spies.setSelected
			};
		},
		get personasStore() {
			return {
				get personas() {
					return state.personas;
				},
				approvePersonas: spies.approvePersonas,
				runInterviews: spies.runInterviews,
				markInterviewsStarted: vi.fn(),
				markInterviewsStopped: vi.fn()
			};
		}
	}
}));

import PersonaWorkspacePage from '$lib/features/admin/topic-detail/persona/GeneratePersonaPage.svelte';

// 採用（selected）はステークホルダー文書に永続する。未設定は既定 ON。
const makeStakeholder = (id: string, role: string, selected?: boolean) => ({
	id,
	role,
	reason: `${role}の理由`,
	mainInterests: [],
	minorityLevel: 'low',
	...(selected !== undefined && { selected })
});

const makePersona = (over: Record<string, unknown>) => ({
	id: 'p',
	topicId: 't1',
	name: '名無し',
	age: 40,
	occupation: '職',
	stakeholderRole: '役',
	specificRole: '役',
	background: '背景',
	interests: '関心',
	approved: false,
	sortOrder: 0,
	beliefs: [],
	...over
});

beforeEach(() => {
	vi.clearAllMocks();
	state.phase = 'stakeholders';
	state.phaseStatus = 'generated';
	state.stakeholders = [];
	state.personas = [];
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
});

describe('PersonaWorkspacePage', () => {
	it('対応ペルソナがある行は右に人物像、無い行は右が空白', async () => {
		state.stakeholders = [makeStakeholder('sid-a', '医師'), makeStakeholder('sid-b', '患者')];
		state.personas = [makePersona({ id: 'p1', name: '田中医師', stakeholderId: 'sid-a' })];

		mount();

		await expect.element(page.getByText('医師', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('患者', { exact: true })).toBeInTheDocument();
		// sid-a の対応ペルソナは表示、sid-b は右側なし（名前は人物像＋取材状態に現れる）
		await expect.element(page.getByText('田中医師').first()).toBeInTheDocument();
	});

	it('チェックを外すと採用状態（selected）をストアに永続させる', async () => {
		state.stakeholders = [makeStakeholder('sid-a', '医師'), makeStakeholder('sid-b', '患者')];
		state.personas = [];

		mount();

		// 既定は全 ON。先頭（sid-a）のチェックを外す
		await page.getByRole('checkbox').nth(0).click({ force: true });

		expect(spies.setSelected).toHaveBeenCalledWith('sid-a', false);
	});

	it('採用外（selected:false）を除いた採用 id のみで generatePersonas を呼ぶ', async () => {
		state.stakeholders = [
			makeStakeholder('sid-a', '医師', false),
			makeStakeholder('sid-b', '患者')
		];
		state.personas = [];

		mount();

		await page.getByRole('button', { name: 'ペルソナを生成する' }).click();

		expect(spies.generatePersonas).toHaveBeenCalledWith(['sid-b']);
	});

	it('採用が0件だとペルソナ生成ボタンが不活性で理由を提示する', async () => {
		state.stakeholders = [makeStakeholder('sid-a', '医師', false)];
		state.personas = [];

		mount();

		await expect.element(page.getByRole('button', { name: 'ペルソナを生成する' })).toBeDisabled();
		await expect
			.element(
				page.getByText('少なくとも1件のステークホルダーを採用してください', { exact: false })
			)
			.toBeInTheDocument();
	});

	it('取材は承認（approvePersonas）を先に呼んでから runInterviews を実行する', async () => {
		state.phase = 'personas';
		state.phaseStatus = 'generated';
		state.stakeholders = [makeStakeholder('sid-a', '医師')];
		state.personas = [makePersona({ id: 'p1', stakeholderId: 'sid-a' })];

		mount();

		await page.getByRole('button', { name: '取材を開始する' }).click();

		expect(spies.approvePersonas).toHaveBeenCalled();
		expect(spies.runInterviews).toHaveBeenCalledWith('テストテーマ');
		expect(spies.approvePersonas.mock.invocationCallOrder[0]).toBeLessThan(
			spies.runInterviews.mock.invocationCallOrder[0]
		);
	});

	it('取材完了後は「章立てへ進む」で approveInterviews と goto を呼ぶ', async () => {
		state.phase = 'interviews';
		state.phaseStatus = 'generated';
		state.stakeholders = [makeStakeholder('sid-a', '医師')];
		state.personas = [
			makePersona({ id: 'p1', stakeholderId: 'sid-a', interview: { status: 'completed' } })
		];

		mount();

		await page.getByRole('button', { name: '章立てへ進む' }).click();

		expect(spies.approveInterviews).toHaveBeenCalled();
		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/chapters');
	});
});
