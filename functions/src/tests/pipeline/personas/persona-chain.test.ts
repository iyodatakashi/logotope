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
vi.mock('../../../agents/persona-generator-agent.js', () => ({
	generatePersonas: mockGeneratePersonas,
	sourceTagForIndex: (index: number) => `S${index + 1}`
}));
vi.mock('../../../pipeline/topics/topic-context.js', () => ({
	getTopicContext: vi.fn(async () => ({ factBase: null }))
}));
vi.mock('../../../api/interviews.js', () => ({ runInterviewCore: mockRunInterviewCore }));
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
});

describe('advancePersonaChain — personas 段', () => {
	const seedStakeholders = () =>
		holder.mock!.store.set(`topics/${TOPIC_ID}/stakeholders/0`, {
			stakeholders: [
				{ id: 'sid-a', role: '医師' },
				{ id: 'sid-b', role: '患者' }
			]
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
		// 採用既定 ON・由来キー・sortOrder が焼き込まれる
		expect(persona('p1')).toMatchObject({
			name: '太郎',
			stakeholderId: 'sid-a',
			sortOrder: 0,
			selected: true
		});
		expect(persona('p2')).toMatchObject({ stakeholderId: 'sid-b', sortOrder: 1, selected: true });
		expect('sourceTag' in (persona('p1') as object)).toBe(false);
		// ペルソナごとに interview 段を投入
		expect(mockEnqueuePersonaStep).toHaveBeenCalledWith({
			topicId: TOPIC_ID,
			runId: RUN_ID,
			stepKind: 'interview',
			personaId: 'p1'
		});
		expect(mockEnqueuePersonaStep).toHaveBeenCalledWith({
			topicId: TOPIC_ID,
			runId: RUN_ID,
			stepKind: 'interview',
			personaId: 'p2'
		});
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
		// specificRole 未設定は stakeholderRole でフォールバック
		expect(persona.specificRole).toBe('医師');
		expect(mockEnqueuePersonaStep).not.toHaveBeenCalled();
	});

	it('personaId が無い interview 段は失敗する', async () => {
		seedRunning();
		await expect(
			advancePersonaChain({ topicId: TOPIC_ID, runId: RUN_ID, stepKind: 'interview' })
		).rejects.toThrow(/personaId is required/);
	});
});
