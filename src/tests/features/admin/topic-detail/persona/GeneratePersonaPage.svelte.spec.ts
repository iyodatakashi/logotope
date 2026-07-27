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
		updatePersona: vi.fn(),
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
				updatePersona: spies.updatePersona,
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
	role: '役',
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
	it('生成済みのペルソナを PersonaItem として一覧表示する', async () => {
		state.phaseStatus = 'generated';
		state.personas = [
			makePersona({ id: 'p1', name: '田中医師', stakeholderId: 'sid-a' }),
			makePersona({ id: 'p2', name: '佐藤患者', stakeholderId: 'sid-b' })
		];

		mount();

		await expect.element(page.getByText('田中医師').first()).toBeInTheDocument();
		await expect.element(page.getByText('佐藤患者').first()).toBeInTheDocument();
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

	it('再生成は確認後にサーバ権威の単一操作のみを呼ぶ（下流 reset を呼ばない）', async () => {
		state.phaseStatus = 'generated';
		state.stakeholders = [makeStakeholder('sid-a', '医師')];
		state.personas = [makePersona({ id: 'p1', stakeholderId: 'sid-a' })];

		mount();

		await page.getByRole('button', { name: 'ペルソナを再生成する' }).click();
		await page.getByRole('button', { name: '再生成する', exact: true }).click();

		expect(spies.startPersonaGeneration).toHaveBeenCalledOnce();
		expect(spies.resetStakeholders).not.toHaveBeenCalled();
		expect(spies.resetPersonas).not.toHaveBeenCalled();
		expect(spies.resetChapters).not.toHaveBeenCalled();
		expect(spies.resetDebate).not.toHaveBeenCalled();
		expect(spies.resetEditing).not.toHaveBeenCalled();
	});

	it('再生成押下直後は旧ペルソナを即時に隠す（実削除の同期反映を待たない）', async () => {
		state.phaseStatus = 'generated';
		state.stakeholders = [makeStakeholder('sid-a', '医師')];
		state.personas = [makePersona({ id: 'p1', name: '田中医師', stakeholderId: 'sid-a' })];
		// 往復中（サーバがまだ running を書かず、旧ペルソナも実削除前）の状態を模擬。
		spies.startPersonaGeneration.mockImplementation(() => new Promise<void>(() => {}));

		mount();

		await expect.element(page.getByText('田中医師').first()).toBeInTheDocument();

		await page.getByRole('button', { name: 'ペルソナを再生成する' }).click();
		await page.getByRole('button', { name: '再生成する', exact: true }).click();

		// 実状態はまだ personas/generated（旧ペルソナ残存）だが、表示専用フラグで即時に隠れる。
		expect(page.getByText('田中医師').elements()).toHaveLength(0);
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

	it('前進が失敗したときは遷移せず操作ペインにエラーを表示する', async () => {
		state.phaseStatus = 'generated';
		state.stakeholders = [makeStakeholder('sid-a', '医師')];
		state.personas = [makePersona({ id: 'p1', stakeholderId: 'sid-a', selected: true })];
		spies.advancePastPersonas.mockRejectedValueOnce(new Error('fail'));

		mount();

		await page.getByRole('button', { name: '次に進む' }).click();

		expect(goto).not.toHaveBeenCalled();
		await expect.element(page.getByRole('alert')).toBeInTheDocument();
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
			makePersona({
				id: 'p1',
				stakeholderId: 'sid-a',
				selected: true,
				interview: { status: 'completed' }
			})
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

		// svelte-ui のトークン未読込でチェックボックスが 0px 幅になり座標ヒットテストが隣の
		// インライン入力に吸われるため、要素へ直接 click を送って onchange 配線を検証する。
		const checkbox = page.getByRole('checkbox').nth(0).element() as HTMLInputElement;
		checkbox.click();

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
