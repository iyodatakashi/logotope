/**
 * advancePersonaChain: 一気通貫チェーンの段判別・生成物永続・次段投入を検証する。
 * - 停止ゲート（世代不一致・非稼働）は no-op
 * - stakeholders 段: 安定 id 付きで永続し personas 段を投入。完了確定は書かない
 * - personas 段: 全ステークホルダーから selected:true で永続し、ペルソナごとに interview 段を投入
 * - interview 段: 当該ペルソナのみ runInterviewCore を呼ぶ（終端・次段を投入しない）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

const mockGenerateStakeholders = vi.hoisted(() => vi.fn());
const mockGeneratePersonas = vi.hoisted(() => vi.fn());
const mockRunInterviewCore = vi.hoisted(() => vi.fn());
const mockRunAvatarCore = vi.hoisted(() => vi.fn());
const mockEnqueuePersonaStep = vi.hoisted(() => vi.fn());
const nanoidSeq = vi.hoisted(() => ({ n: 0 }));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' }
}));
vi.mock('nanoid', () => ({ nanoid: () => `sid-${++nanoidSeq.n}` }));
vi.mock('../../../agents/stakeholder-agent.js', () => ({
	generateStakeholders: mockGenerateStakeholders
}));
// 由来解決（resolveSourceStakeholder）は実体を使う。突合の規則そのものがこの段の検査対象なので、
// 差し替えると「由来の突合が維持されること」の検査が空回りする。
vi.mock('../../../agents/persona-generator-agent.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../../agents/persona-generator-agent.js')>()),
	generatePersonas: mockGeneratePersonas
}));
vi.mock('../../../pipeline/topics/topic-context.js', () => ({
	getTopicContext: vi.fn(async () => ({ factBase: null }))
}));
vi.mock('../../../api/interviews.js', () => ({ runInterviewCore: mockRunInterviewCore }));
vi.mock('../../../api/avatars.js', () => ({ runAvatarCore: mockRunAvatarCore }));
vi.mock('../../../pipeline/personas/enqueue-persona-step.js', () => ({
	enqueuePersonaStep: mockEnqueuePersonaStep
}));

import { advancePersonaChain } from '../../../pipeline/personas/persona-chain.js';

const TOPIC_ID = 't1';
const RUN_ID = 'run-A';
const topic = () => holder.mock!.store.get(`topics/${TOPIC_ID}`);
const stakeholdersDoc = () => holder.mock!.store.get(`topics/${TOPIC_ID}/stakeholders/0`);
const persona = (id: string) => holder.mock!.store.get(`topics/${TOPIC_ID}/personas/${id}`);

const seedRunning = () =>
	holder.mock!.store.set(`topics/${TOPIC_ID}`, {
		title: 'AIと社会',
		phase: 'personas',
		phaseStatus: 'running',
		runId: RUN_ID
	});

beforeEach(() => {
	vi.clearAllMocks();
	nanoidSeq.n = 0;
	holder.mock = createFirestoreMock();
});

describe('advancePersonaChain — 停止ゲート', () => {
	it('世代不一致（runId 不一致）なら何も実行しない', async () => {
		seedRunning();
		await advancePersonaChain({ topicId: TOPIC_ID, runId: 'other', stepKind: 'stakeholders' });
		expect(mockGenerateStakeholders).not.toHaveBeenCalled();
		expect(mockEnqueuePersonaStep).not.toHaveBeenCalled();
	});

	it('非稼働（phaseStatus generated）なら何も実行しない', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			phase: 'personas',
			phaseStatus: 'generated',
			runId: RUN_ID
		});
		await advancePersonaChain({ topicId: TOPIC_ID, runId: RUN_ID, stepKind: 'stakeholders' });
		expect(mockGenerateStakeholders).not.toHaveBeenCalled();
	});
});

describe('advancePersonaChain — stakeholders 段', () => {
	it('安定 id 付きで永続し personas 段を投入する（完了確定は書かない）', async () => {
		seedRunning();
		mockGenerateStakeholders.mockResolvedValueOnce({
			ok: true,
			value: { stakeholders: [{ role: '医師' }, { role: '患者' }] }
		});

		await advancePersonaChain({ topicId: TOPIC_ID, runId: RUN_ID, stepKind: 'stakeholders' });

		const stored = stakeholdersDoc() as { stakeholders: { id: string; role: string }[] };
		expect(stored.stakeholders.map((s) => s.id)).toEqual(['sid-1', 'sid-2']);
		expect(stored.stakeholders.map((s) => s.role)).toEqual(['医師', '患者']);
		expect(mockEnqueuePersonaStep).toHaveBeenCalledWith({
			topicId: TOPIC_ID,
			runId: RUN_ID,
			stepKind: 'personas'
		});
		// 中間段は generated を確定しない（running のまま）
		expect(topic()?.phaseStatus).toBe('running');
	});

	it('立場の属性（所在・3軸・当事者である理由）を落とさずに永続する', async () => {
		seedRunning();
		mockGenerateStakeholders.mockResolvedValueOnce({
			ok: true,
			value: {
				stakeholders: [
					{
						role: '基地周辺の住民',
						stakeReason: '騒音と事故の危険を日常として引き受けている',
						mainInterests: ['騒音'],
						country: '日本',
						prefecture: '沖縄県',
						stakeLevel: 'high',
						minorityLevel: 'high',
						engagementLevel: 'medium'
					}
				]
			}
		});

		await advancePersonaChain({ topicId: TOPIC_ID, runId: RUN_ID, stepKind: 'stakeholders' });

		const stored = stakeholdersDoc() as { stakeholders: Record<string, unknown>[] };
		expect(stored.stakeholders[0]).toEqual({
			id: 'sid-1',
			role: '基地周辺の住民',
			stakeReason: '騒音と事故の危険を日常として引き受けている',
			mainInterests: ['騒音'],
			country: '日本',
			prefecture: '沖縄県',
			stakeLevel: 'high',
			minorityLevel: 'high',
			engagementLevel: 'medium'
		});
	});
});

describe('advancePersonaChain — personas 段', () => {
	const seedStakeholders = () =>
		holder.mock!.store.set(`topics/${TOPIC_ID}/stakeholders/0`, {
			stakeholders: [
				{ id: 'sid-a', role: '医師' },
				{ id: 'sid-b', role: '患者' }
			]
		});

	it('所在を持たない人物を永続できる（未設定を undefined で書かない）', async () => {
		seedRunning();
		seedStakeholders();
		mockGeneratePersonas.mockResolvedValueOnce({
			ok: true,
			value: {
				personas: [
					{ id: 'p1', sourceTag: 'S1', stakeholderRole: '医師', name: 'マリア・シルバ' },
					{
						id: 'p2',
						sourceTag: 'S2',
						stakeholderRole: '患者',
						name: '比嘉 美和',
						prefecture: '沖縄県'
					}
				]
			}
		});

		// 本番 Firestore は undefined を値にできない。所在を持たない人物が1体でも混じると
		// batch 全体が弾かれるため、キーの不在で表せているかをここで担保する。
		await advancePersonaChain({ topicId: TOPIC_ID, runId: RUN_ID, stepKind: 'personas' });

		expect('country' in (persona('p1') as object)).toBe(false);
		expect('prefecture' in (persona('p1') as object)).toBe(false);
		expect(persona('p2')).toMatchObject({ prefecture: '沖縄県' });
	});

	it('立場の所在がペルソナ生成へ届き、由来の突合が維持される', async () => {
		seedRunning();
		holder.mock!.store.set(`topics/${TOPIC_ID}/stakeholders/0`, {
			stakeholders: [
				{ id: 'sid-a', role: '開発企業の研究者', country: 'アメリカ合衆国' },
				{ id: 'sid-b', role: '基地周辺の住民', country: '日本', prefecture: '沖縄県' }
			]
		});
		mockGeneratePersonas.mockResolvedValueOnce({
			ok: true,
			value: {
				personas: [
					{ id: 'p1', sourceTag: 'S2', stakeholderRole: '基地周辺の住民', name: '比嘉 美和' },
					{ id: 'p2', sourceTag: 'S1', stakeholderRole: '開発企業の研究者', name: 'サラ・チェン' }
				]
			}
		});

		await advancePersonaChain({ topicId: TOPIC_ID, runId: RUN_ID, stepKind: 'personas' });

		const [, passedStakeholders] = mockGeneratePersonas.mock.calls[0];
		expect(passedStakeholders[0].country).toBe('アメリカ合衆国');
		expect(passedStakeholders[1].prefecture).toBe('沖縄県');
		// 出力順が入れ替わってもエコー用タグで由来が解決される
		expect(persona('p1')).toMatchObject({ stakeholderId: 'sid-b' });
		expect(persona('p2')).toMatchObject({ stakeholderId: 'sid-a' });
	});

	it('全ステークホルダーから selected:true で永続し、ペルソナごとに interview 段を投入する', async () => {
		seedRunning();
		seedStakeholders();
		mockGeneratePersonas.mockResolvedValueOnce({
			ok: true,
			value: {
				personas: [
					{ id: 'p1', sourceTag: 'S1', stakeholderRole: '医師', name: '太郎' },
					{ id: 'p2', sourceTag: 'S2', stakeholderRole: '患者', name: '花子' }
				]
			}
		});

		await advancePersonaChain({ topicId: TOPIC_ID, runId: RUN_ID, stepKind: 'personas' });

		// 生成対象は全ステークホルダー（採用フィルタなし）
		const [, passedStakeholders] = mockGeneratePersonas.mock.calls[0];
		expect(passedStakeholders.map((s: { id: string }) => s.id)).toEqual(['sid-a', 'sid-b']);
		// 立場の属性は絞らずそのまま渡す（死蔵を作らない）
		expect(passedStakeholders[0]).toEqual({ id: 'sid-a', role: '医師' });
		// 採用既定 ON・由来キー・sortOrder が焼き込まれる
		expect(persona('p1')).toMatchObject({
			name: '太郎',
			stakeholderId: 'sid-a',
			sortOrder: 0,
			selected: true
		});
		expect(persona('p2')).toMatchObject({ stakeholderId: 'sid-b', sortOrder: 1, selected: true });
		expect('sourceTag' in (persona('p1') as object)).toBe(false);
		// ペルソナごとに interview 段と avatar 段を投入
		for (const id of ['p1', 'p2']) {
			expect(mockEnqueuePersonaStep).toHaveBeenCalledWith({
				topicId: TOPIC_ID,
				runId: RUN_ID,
				stepKind: 'interview',
				personaId: id
			});
			expect(mockEnqueuePersonaStep).toHaveBeenCalledWith({
				topicId: TOPIC_ID,
				runId: RUN_ID,
				stepKind: 'avatar',
				personaId: id
			});
		}
		expect(topic()?.phaseStatus).toBe('running');
	});

	it('前段の stakeholders/0 が無ければ失敗する（前段未完の防御）', async () => {
		seedRunning();
		await expect(
			advancePersonaChain({ topicId: TOPIC_ID, runId: RUN_ID, stepKind: 'personas' })
		).rejects.toThrow(/stakeholders not found/);
	});
});

describe('advancePersonaChain — interview 段', () => {
	it('当該ペルソナのみ runInterviewCore を呼び、次段を投入しない', async () => {
		seedRunning();
		holder.mock!.store.set(`topics/${TOPIC_ID}/personas/p1`, {
			name: '太郎',
			role: '救急医',
			stakeholderRole: '医師'
		});

		await advancePersonaChain({
			topicId: TOPIC_ID,
			runId: RUN_ID,
			stepKind: 'interview',
			personaId: 'p1'
		});

		expect(mockRunInterviewCore).toHaveBeenCalledTimes(1);
		const [topicId, personaId, topicTitle, persona] = mockRunInterviewCore.mock.calls[0];
		expect(topicId).toBe(TOPIC_ID);
		expect(personaId).toBe('p1');
		expect(topicTitle).toBe('AIと社会');
		// role を直参照する（stakeholderRole への総称フォールバックは持たない）
		expect(persona.role).toBe('救急医');
		expect(mockEnqueuePersonaStep).not.toHaveBeenCalled();
	});

	it('personaId が無い interview 段は失敗する', async () => {
		seedRunning();
		await expect(
			advancePersonaChain({ topicId: TOPIC_ID, runId: RUN_ID, stepKind: 'interview' })
		).rejects.toThrow(/personaId is required/);
	});
});

describe('advancePersonaChain — avatar 段', () => {
	it('当該ペルソナの runAvatarCore を呼び、次段を投入しない', async () => {
		seedRunning();
		await advancePersonaChain({
			topicId: TOPIC_ID,
			runId: RUN_ID,
			stepKind: 'avatar',
			personaId: 'p1'
		});

		expect(mockRunAvatarCore).toHaveBeenCalledWith(TOPIC_ID, 'p1');
		expect(mockEnqueuePersonaStep).not.toHaveBeenCalled();
	});

	it('取材完了で generated 遷移済み（非 running）でも running ゲートを迂回して生成する', async () => {
		// 取材が全件完了すると personas は generated になる。並走中の avatar 段はここでも生成できる。
		holder.mock!.store.set(`topics/${TOPIC_ID}`, {
			phase: 'personas',
			phaseStatus: 'generated',
			runId: RUN_ID
		});

		await advancePersonaChain({
			topicId: TOPIC_ID,
			runId: RUN_ID,
			stepKind: 'avatar',
			personaId: 'p1'
		});

		expect(mockRunAvatarCore).toHaveBeenCalledWith(TOPIC_ID, 'p1');
	});

	it('personaId が無い avatar 段は失敗する', async () => {
		seedRunning();
		await expect(
			advancePersonaChain({ topicId: TOPIC_ID, runId: RUN_ID, stepKind: 'avatar' })
		).rejects.toThrow(/personaId is required/);
	});
});
