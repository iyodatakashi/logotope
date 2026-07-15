import { page } from 'vitest/browser';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';

let unmount: (() => void) | undefined;
const mount = () => {
	const result = render(GeneratePersonaPage);
	unmount = result.unmount;
	return result;
};

const { goto, spies, state } = vi.hoisted(() => ({
	goto: vi.fn(),
	spies: {
		startPersonaGeneration: vi.fn(),
		advancePastPersonas: vi.fn(),
		resetStakeholders: vi.fn(),
		resetPersonas: vi.fn(),
		resetChapters: vi.fn(),
		resetDebate: vi.fn(),
		resetEditing: vi.fn(),
		setSelected: vi.fn(),
		reinterview: vi.fn()
	},
	state: {
		phase: 'personas' as string,
		phaseStatus: 'not_started' as string,
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
				startPersonaGeneration: spies.startPersonaGeneration,
				advancePastPersonas: spies.advancePastPersonas,
				resetStakeholders: spies.resetStakeholders,
				resetPersonas: spies.resetPersonas,
				resetChapters: spies.resetChapters,
				resetDebate: spies.resetDebate,
				resetEditing: spies.resetEditing
			};
		},
		get stakeholdersStore() {
			return {
				get stakeholders() {
					return state.stakeholders;
				}
			};
		},
		get personasStore() {
			return {
				get personas() {
					return state.personas;
				},
				setSelected: spies.setSelected,
				reinterview: spies.reinterview
			};
		}
	}
}));

import GeneratePersonaPage from '$lib/features/admin/topic-detail/persona/GeneratePersonaPage.svelte';

// ステークホルダーは採用選択を持たない中間生成物。
const makeStakeholder = (id: string, role: string) => ({
	id,
	role,
	reason: `${role}の理由`,
	mainInterests: [],
	minorityLevel: 'low'
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
	selected: true,
	sortOrder: 0,
	beliefs: [],
	...over
});

beforeEach(() => {
	vi.clearAllMocks();
	state.phase = 'personas';
	state.phaseStatus = 'not_started';
	state.stakeholders = [];
	state.personas = [];
});

afterEach(() => {
	unmount?.();
	unmount = undefined;
});

describe('GeneratePersonaPage', () => {
	it('対応ペルソナがある行は右に人物像、無い行は右が空白（対応関係を表示）', async () => {
		state.phaseStatus = 'generated';
		state.stakeholders = [makeStakeholder('sid-a', '医師'), makeStakeholder('sid-b', '患者')];
		state.personas = [makePersona({ id: 'p1', name: '田中医師', stakeholderId: 'sid-a' })];

		mount();

		await expect.element(page.getByText('医師', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('患者', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('田中医師').first()).toBeInTheDocument();
	});

	it('未生成では単一の「ペルソナを生成する」で一気通貫を起動する', async () => {
		state.phaseStatus = 'not_started';

		mount();

		await page.getByRole('button', { name: 'ペルソナを生成する' }).click();

		expect(spies.startPersonaGeneration).toHaveBeenCalledOnce();
	});

	it('生成済みでは「再生成する」を表示し、独立生成操作は出さない', async () => {
		state.phaseStatus = 'generated';
		state.stakeholders = [makeStakeholder('sid-a', '医師')];
		state.personas = [makePersona({ id: 'p1', stakeholderId: 'sid-a' })];

		mount();

		await expect
			.element(page.getByRole('button', { name: 'ペルソナを再生成する' }))
			.toBeInTheDocument();
		expect(page.getByRole('button', { name: 'ペルソナを生成する' }).elements()).toHaveLength(0);
	});

	it('採用ペルソナが1件以上あれば「次に進む」で advancePastPersonas と goto を呼ぶ', async () => {
		state.phaseStatus = 'generated';
		state.stakeholders = [makeStakeholder('sid-a', '医師')];
		state.personas = [
			makePersona({
				id: 'p1',
				stakeholderId: 'sid-a',
				selected: true,
				interview: { status: 'completed' }
			})
		];

		mount();

		await page.getByRole('button', { name: '次に進む' }).click();

		expect(spies.advancePastPersonas).toHaveBeenCalledOnce();
		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/chapters');
	});

	it('採用が0件だと「次に進む」が不活性になる（採用ゲート）', async () => {
		state.phaseStatus = 'generated';
		state.stakeholders = [makeStakeholder('sid-a', '医師')];
		state.personas = [makePersona({ id: 'p1', stakeholderId: 'sid-a', selected: false })];

		mount();

		await expect.element(page.getByRole('button', { name: '次に進む' })).toBeDisabled();
	});

	it('前進後に見返した状態（approved）でも「ペルソナを再生成する」を表示し、次に進むは活性のまま遷移のみ行う', async () => {
		// 一度 chapters へ前進してから戻ってきた状態（topic.phase は chapters）。
		state.phase = 'chapters';
		state.phaseStatus = 'not_started';
		state.stakeholders = [makeStakeholder('sid-a', '医師')];
		state.personas = [
			makePersona({ id: 'p1', stakeholderId: 'sid-a', selected: true, interview: { status: 'completed' } })
		];

		mount();

		// 生成済みなので実行ボタンではなく再生成を出す
		await expect
			.element(page.getByRole('button', { name: 'ペルソナを再生成する' }))
			.toBeInTheDocument();
		// 次に進むは活性。押しても既に前進済みなので advancePastPersonas は呼ばず遷移のみ（章立てを巻き戻さない）
		await page.getByRole('button', { name: '次に進む' }).click();
		expect(spies.advancePastPersonas).not.toHaveBeenCalled();
		expect(goto).toHaveBeenCalledWith('/admin/topics/t1/chapters');
	});

	it('ペルソナの採用チェックを外すと setSelected をストアに永続させる', async () => {
		state.phaseStatus = 'generated';
		state.stakeholders = [makeStakeholder('sid-a', '医師')];
		state.personas = [makePersona({ id: 'p1', stakeholderId: 'sid-a', selected: true })];

		mount();

		await page.getByRole('checkbox').nth(0).click({ force: true });

		expect(spies.setSelected).toHaveBeenCalledWith('p1', false);
	});

	it('ペルソナの再取材ボタンで単一ペルソナの reinterview を呼ぶ', async () => {
		state.phaseStatus = 'generated';
		state.stakeholders = [makeStakeholder('sid-a', '医師')];
		state.personas = [makePersona({ id: 'p1', stakeholderId: 'sid-a' })];

		mount();

		await page.getByRole('button', { name: '再取材する' }).click();

		expect(spies.reinterview).toHaveBeenCalledWith('p1', 'テストテーマ');
	});
});
