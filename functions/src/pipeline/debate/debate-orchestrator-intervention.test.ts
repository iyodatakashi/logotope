import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
	mockUpdate, mockSet, mockTxUpdate,
	mockGetTopicById, mockGetPersonasByTopicId, mockGetDebateSessionByTopicId,
	mockGenerateOpening, mockEvaluateTopicDrift, mockEvaluateStallIntervention, mockGenerateClosing,
	mockGenerateTurn, mockAssessEngagement,
} = vi.hoisted(() => ({
	mockUpdate: vi.fn().mockResolvedValue(undefined),
	mockSet: vi.fn().mockResolvedValue(undefined),
	mockTxUpdate: vi.fn(),
	mockGetTopicById: vi.fn(),
	mockGetPersonasByTopicId: vi.fn(),
	mockGetDebateSessionByTopicId: vi.fn(),
	mockGenerateOpening: vi.fn(),
	mockEvaluateTopicDrift: vi.fn(),
	mockEvaluateStallIntervention: vi.fn(),
	mockGenerateClosing: vi.fn(),
	mockGenerateTurn: vi.fn(),
	mockAssessEngagement: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({
		doc: vi.fn().mockImplementation((path: string) => ({
			get: vi.fn().mockResolvedValue({
				exists: true,
				data: () =>
					path.includes('/sessions/') || path.includes('/engagements/')
						? { turns: [] }
						: { phase: 5, phaseStatus: 'running' },
			}),
			update: mockUpdate,
			set: mockSet,
		})),
		collection: vi.fn().mockReturnValue({
			get: vi.fn().mockResolvedValue({ docs: [] }),
		}),
		runTransaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
			fn({
				get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ phaseStatus: 'running' }) }),
				update: mockTxUpdate,
			})
		),
	})),
	Timestamp: { now: vi.fn(() => ({ toDate: () => new Date() })) },
	FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args[0]) },
}));

vi.mock('../../db/repository.js', () => ({
	getTopicById: mockGetTopicById,
	getPersonasByTopicId: mockGetPersonasByTopicId,
	getDebateSessionByTopicId: mockGetDebateSessionByTopicId,
}));

vi.mock('../../agents/facilitator-agent.js', () => ({
	generateOpening: mockGenerateOpening,
	evaluateTopicDrift: mockEvaluateTopicDrift,
	evaluateStallIntervention: mockEvaluateStallIntervention,
	generateClosing: mockGenerateClosing,
	generateChapterSummary: vi.fn().mockResolvedValue({ ok: true, value: 'まとめ。' }),
	generateChapterIntroduction: vi.fn().mockResolvedValue({ ok: true, value: { content: '次章。' } }),
}));

vi.mock('../../agents/persona-agent.js', () => ({
	generateTurn: mockGenerateTurn,
	assessEngagement: mockAssessEngagement,
	generatePostDebateComment: vi.fn().mockImplementation(async (persona: { id: string }) => ({
		ok: true,
		value: { personaId: persona.id, content: 'コメント' },
	})),
}));

vi.mock('nanoid', () => ({ nanoid: vi.fn().mockReturnValue('test-id') }));

import { executeChapterTask } from './debate-orchestrator.js';

const testPersonas = [
	{
		id: 'p1', topicId: 't1', name: '田中', stakeholderRole: '医師',
		age: 45, occupation: '医師', background: '経験豊富', interests: '医療安全',
		approved: true, sortOrder: 0,
	},
	{
		id: 'p2', topicId: 't1', name: '鈴木', stakeholderRole: '患者',
		age: 35, occupation: '会社員', background: '患者歴10年', interests: '費用',
		approved: true, sortOrder: 1,
	},
];

const singleChapter = [{ id: 'ch-0', title: '導入', focusQuestion: '核心は？' }];
const shortOpts = { turnsPerChapter: 2, maxTurns: 40, interventionCooldown: 0 };

function setupDefaults() {
	mockGetTopicById.mockResolvedValue({ id: 't1', title: 'テスト討論', createdAt: '', updatedAt: '' });
	mockGetPersonasByTopicId.mockResolvedValue(testPersonas);
	mockGetDebateSessionByTopicId.mockResolvedValue({
		id: 't1', topicId: 't1', createdAt: '',
		chapters: singleChapter,
		currentChapterIndex: 0,
	});
	mockGenerateOpening.mockResolvedValue({ ok: true, value: { content: '討論開始。', targetPersonaId: undefined } });
	mockGenerateTurn.mockResolvedValue({ ok: true, value: { content: '発言です。', speechMode: 'opinion', beliefChange: null, targetPersonaId: undefined } });
	mockAssessEngagement.mockResolvedValue({ ok: true, value: { score: 3, mode: 'opinion', intentSummary: undefined } });
	mockEvaluateTopicDrift.mockResolvedValue({ ok: true, value: {} });
	mockEvaluateStallIntervention.mockResolvedValue({ ok: true, value: {} });
	mockGenerateClosing.mockResolvedValue({ ok: true, value: 'お疲れ様でした。' });
}

beforeEach(() => {
	vi.clearAllMocks();
	setupDefaults();
});

describe('executeTurn 介入パス (task 5.2)', () => {
	it('ドリフト介入発火時に generateTurn が呼ばれない（generatePersonaTurn をスキップ）', async () => {
		mockEvaluateTopicDrift
			.mockResolvedValueOnce({ ok: true, value: { content: '論点逸れ。', targetPersonaId: 'p2' } })
			.mockResolvedValue({ ok: true, value: {} });

		await executeChapterTask('t1', 0, shortOpts);

		// Without fix: generateTurn called in drift iteration AND in subsequent iteration → count >= 2
		// With fix: generateTurn called only in iteration AFTER drift → count == 1
		expect(mockGenerateTurn.mock.calls.length).toBe(1);
	});

	it('ドリフト介入発火後の次イテレーションで指名ペルソナが targetedBy:facilitator で発言する', async () => {
		mockEvaluateTopicDrift
			.mockResolvedValueOnce({ ok: true, value: { content: '論点逸れ。', targetPersonaId: 'p2' } })
			.mockResolvedValue({ ok: true, value: {} });

		await executeChapterTask('t1', 0, shortOpts);

		expect(mockGenerateTurn.mock.calls.length).toBeGreaterThanOrEqual(1);
		const firstPersonaCall = mockGenerateTurn.mock.calls[0];
		expect((firstPersonaCall[0] as { id: string }).id).toBe('p2');
		expect((firstPersonaCall[1] as { targetedBy?: string }).targetedBy).toBe('facilitator');
	});

	it('出尽くし介入（stall）発火時も generateTurn が呼ばれない（即時保存＋早期リターン）', async () => {
		// interventionCooldown=999 → drift cooldown not passed → only stall check
		mockEvaluateStallIntervention
			.mockResolvedValueOnce({ ok: true, value: { content: '議論停滞。', targetPersonaId: 'p1' } })
			.mockResolvedValue({ ok: true, value: {} });

		await executeChapterTask('t1', 0, { ...shortOpts, interventionCooldown: 999 });

		// Without fix: generateTurn called in stall iteration too
		// With fix: generateTurn called only in iteration after stall
		expect(mockGenerateTurn.mock.calls.length).toBe(1);
	});

	it('介入なし時は通常フロー（generateTurn が毎ターン呼ばれる）が維持される', async () => {
		// cap = ceil(2 * 1.5) = 3. opening(1 turn) + 2 persona turns → exit
		await executeChapterTask('t1', 0, shortOpts);

		expect(mockGenerateTurn.mock.calls.length).toBe(2);
	});
});

describe('介入後ターン順序の統合テスト (task 5.3)', () => {
	it('介入発火→次イテレーションでファシリテーター→ペルソナの順にターンが保存される', async () => {
		mockEvaluateTopicDrift
			.mockResolvedValueOnce({ ok: true, value: { content: '論点逸れ。', targetPersonaId: 'p2' } })
			.mockResolvedValue({ ok: true, value: {} });

		await executeChapterTask('t1', 0, shortOpts);

		// addTurn calls: each does db().doc(...).update({ turns: <turn object> })
		// FieldValue.arrayUnion mock returns turn object itself
		const updateCalls = mockUpdate.mock.calls as Array<[Record<string, unknown>]>;
		const turnUpdates = updateCalls
			.filter(([payload]) => payload && 'turns' in payload)
			.map(([payload]) => payload.turns as { speakerType: string });

		// Expected order: opening(facilitator), intervention(facilitator), persona
		expect(turnUpdates.length).toBeGreaterThanOrEqual(3);
		expect(turnUpdates[1].speakerType).toBe('facilitator'); // intervention before persona
		expect(turnUpdates[2].speakerType).toBe('persona');     // persona after intervention
	});

	it('介入後イテレーションで assessEngagement が全ペルソナを対象とする（lastSpeakerId クリア確認）', async () => {
		mockEvaluateTopicDrift
			.mockResolvedValueOnce({ ok: true, value: { content: '論点逸れ。', targetPersonaId: 'p2' } })
			.mockResolvedValue({ ok: true, value: {} });

		await executeChapterTask('t1', 0, shortOpts);

		// After drift intervention lastSpeakerId is cleared → next evaluateEngagement assesses all personas
		const assessedPersonas = mockAssessEngagement.mock.calls.map(
			(c: unknown[]) => (c[0] as { id: string }).id
		);
		// Both p1 and p2 should appear in engagements across iterations
		expect(assessedPersonas).toContain('p1');
		expect(assessedPersonas).toContain('p2');
	});
});
