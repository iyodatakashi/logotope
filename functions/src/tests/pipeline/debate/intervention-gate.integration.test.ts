/**
 * 介入ゲート緩和（Task 4）の結合テスト。
 * インメモリ Firestore 上で advanceDebate を 1 ステップ駆動し、ペルソナ指名チェーン中の
 * 介入評価・発火時のファシリテーターのみ保存・facilitator 指名時の非介入・チェーン長リセットを検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { StepPayload } from '../../../types/step.types.js';
import type { DebateTurn } from '../../../types/turn.types.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	FieldValue: {
		delete: () => holder.mock!.FieldValue.delete(),
		arrayUnion: (...v: unknown[]) => holder.mock!.FieldValue.arrayUnion(...v)
	},
	Timestamp: { now: () => 'TS' }
}));

vi.mock('nanoid', () => {
	let n = 0;
	return { nanoid: () => `gen-${n++}` };
});

const mockGenerateTurn = vi.fn();
vi.mock('../../../agents/persona-agent.js', () => ({
	generateTurn: (...a: unknown[]) => mockGenerateTurn(...a),
	generateImpression: vi.fn(async () => ({ ok: true, value: { content: 'comment' } }))
}));

const mockEvaluateTopicDrift = vi.fn();
const mockEvaluateStallIntervention = vi.fn();
vi.mock('../../../agents/facilitator-agent.js', () => ({
	generateOpening: vi.fn(async () => ({ ok: true, value: { content: 'opening' } })),
	generateChapterIntroduction: vi.fn(async () => ({ ok: true, value: { content: 'intro' } })),
	evaluateTopicDrift: (...a: unknown[]) => mockEvaluateTopicDrift(...a),
	evaluateStallIntervention: (...a: unknown[]) => mockEvaluateStallIntervention(...a),
	evaluateDiscussionPointCoverage: vi.fn(async () => ({ ok: true, value: [] }))
}));

vi.mock('../../../pipeline/debate/engagement.js', () => ({
	evaluateEngagements: vi.fn(async () => [
		{ personaId: 'p1', score: 5, mode: 'opinion' },
		{ personaId: 'p2', score: 5, mode: 'opinion' }
	]),
	evaluateEngagementWithFallback: vi.fn(async ({ personaId }: { personaId: string }) => ({
		personaId,
		score: 5,
		mode: 'opinion'
	}))
}));

vi.mock('../../../pipeline/topics/topics.js', () => ({
	getTopicById: vi.fn(async () => ({ id: 'topic1', title: 'T' }))
}));
vi.mock('../../../pipeline/personas/personas.js', () => ({
	getPersonasByTopicId: vi.fn(async () => [
		{ id: 'p1', name: 'A', approved: true, beliefs: [] },
		{ id: 'p2', name: 'B', approved: true, beliefs: [] }
	])
}));

const stepQueue: StepPayload[] = [];
const enqueuedKeys = new Set<string>();
vi.mock('../../../pipeline/debate/enqueue-step.js', () => ({
	taskKey: (p: { runId: string; chapterId: string; frontierIndex: number | 'comments' }) =>
		`${p.runId}:${p.chapterId}:${p.frontierIndex}`,
	hashTaskId: (k: string) => k,
	enqueueStep: async (payload: StepPayload, key: string) => {
		if (enqueuedKeys.has(key)) return;
		enqueuedKeys.add(key);
		stepQueue.push(payload);
	}
}));

import { advanceDebate } from '../../../pipeline/debate/debate-orchestrator.js';
import { countConsecutivePersonaTargets } from '../../../pipeline/debate/intervention.js';
import { MAX_TURNS } from '../../../constants/debate.constants.js';

const TOPIC_ID = 'topic1';
const RUN_ID = 'run1';

const personaTarget = (id: string, speaker: string, target: string): Record<string, unknown> => ({
	id,
	speakerType: 'persona',
	personaId: speaker,
	content: '発言',
	createdAt: 'TS',
	speechMode: 'question',
	targetPersonaId: target,
	targetedBy: 'persona'
});

const facilitatorTarget = (id: string, target: string): Record<string, unknown> => ({
	id,
	speakerType: 'facilitator',
	content: '介入',
	createdAt: 'TS',
	targetPersonaId: target,
	targetedBy: 'facilitator'
});

const seedChapter = (turns: Array<Record<string, unknown>>) => {
	holder.mock = createFirestoreMock();
	holder.mock.store.set(`topics/${TOPIC_ID}`, {
		phase: 'debate',
		phaseStatus: 'running',
		runId: RUN_ID,
		title: 'T'
	});
	holder.mock.store.set(`topics/${TOPIC_ID}/chapters/ch1`, {
		chapterIndex: 0,
		title: '章0',
		discussionPoints: ['論点A'],
		turns,
		status: 'running'
	});
	stepQueue.length = 0;
	enqueuedKeys.clear();
};

const chapterTurns = (): Array<Record<string, unknown>> =>
	(holder.mock!.store.get(`topics/${TOPIC_ID}/chapters/ch1`)?.turns ?? []) as Array<
		Record<string, unknown>
	>;

const turnPayload = (expectedTurnIndex: number): StepPayload => ({
	topicId: TOPIC_ID,
	chapterIndex: 0,
	runId: RUN_ID,
	stepKind: 'turn',
	expectedTurnIndex
});

// opening(facilitator) + 連続するペルソナ指名 count 件（p1⇄p2 を交互に指名する指名チェーン）
const chainTurns = (count: number): Array<Record<string, unknown>> => {
	const turns: Array<Record<string, unknown>> = [
		{ id: 'opening', speakerType: 'facilitator', content: 'opening', createdAt: 'TS' }
	];
	for (let i = 0; i < count; i++) {
		const speaker = i % 2 === 0 ? 'p1' : 'p2';
		const target = i % 2 === 0 ? 'p2' : 'p1';
		turns.push(personaTarget(`t${i + 1}`, speaker, target));
	}
	return turns;
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Math, 'random').mockReturnValue(0);
	mockGenerateTurn.mockImplementation(async () => ({
		ok: true,
		value: { content: 'turn', speechMode: 'opinion', beliefChange: null }
	}));
	mockEvaluateTopicDrift.mockResolvedValue({ ok: true, value: { content: undefined } });
	mockEvaluateStallIntervention.mockResolvedValue({ ok: true, value: { content: undefined } });
});

describe('介入ゲート: ペルソナ指名チェーン中の drift 発火', () => {
	// chainTurns(5) = opening + ペルソナ指名 5 件（persona-chain クールダウン 5 を満たす）。expectedTurnIndex=6
	it('drift 発火時はファシリテーターターンのみ保存し、同ステップでペルソナ応答を生成しない', async () => {
		seedChapter(chainTurns(5));
		mockEvaluateTopicDrift.mockResolvedValue({
			ok: true,
			value: { content: '本題に戻しましょう', targetPersonaId: 'p2' }
		});

		await advanceDebate(turnPayload(6));

		const turns = chapterTurns();
		expect(turns).toHaveLength(7);
		expect(turns[6].speakerType).toBe('facilitator');
		expect(mockGenerateTurn).not.toHaveBeenCalled();
	});

	it('drift 発火後はチェーン長が 0 にリセットされる（末尾が facilitator）', async () => {
		seedChapter(chainTurns(5));
		mockEvaluateTopicDrift.mockResolvedValue({
			ok: true,
			value: { content: '本題に戻しましょう', targetPersonaId: 'p2' }
		});

		await advanceDebate(turnPayload(6));

		expect(countConsecutivePersonaTargets(chapterTurns() as DebateTurn[])).toBe(0);
	});

	it('drift 見送り時は指名先（直前ターンの target）が応答する', async () => {
		seedChapter(chainTurns(5));
		// drift は見送り（content なし）

		await advanceDebate(turnPayload(6));

		const turns = chapterTurns();
		expect(mockEvaluateTopicDrift).toHaveBeenCalledTimes(1);
		expect(turns[6].speakerType).toBe('persona');
		expect(turns[6].personaId).toBe('p2');
	});

	it('チェーンがクールダウン未満（5 未満）のうちは介入を評価せず指名先が応答する', async () => {
		seedChapter(chainTurns(3)); // ペルソナ指名 3 件 → 3 < 5 で評価対象外。expectedTurnIndex=4
		mockEvaluateTopicDrift.mockResolvedValue({
			ok: true,
			value: { content: '本題に戻しましょう', targetPersonaId: 'p2' }
		});

		await advanceDebate(turnPayload(4));

		const turns = chapterTurns();
		expect(mockEvaluateTopicDrift).not.toHaveBeenCalled();
		expect(turns[4].speakerType).toBe('persona');
		expect(turns[4].personaId).toBe('p2');
	});
});

describe('介入ゲート: facilitator 指名は介入せず指名先が応答', () => {
	it('末尾が targetedBy=facilitator の指名なら drift を評価せず指名先が応答する', async () => {
		seedChapter([...chainTurns(5), facilitatorTarget('f2', 'p1')]); // 末尾 facilitator 指名。expectedTurnIndex=7
		mockEvaluateTopicDrift.mockResolvedValue({
			ok: true,
			value: { content: '割り込み', targetPersonaId: 'p2' }
		});

		await advanceDebate(turnPayload(7));

		const turns = chapterTurns();
		expect(mockEvaluateTopicDrift).not.toHaveBeenCalled();
		expect(turns[7].speakerType).toBe('persona');
		expect(turns[7].personaId).toBe('p1');
	});
});

// 章ドキュメントに論点ステータス（2集合付き）を仕込んで seed する（loadChapterProgress が復元する）
type SeedStatus = {
	point: string;
	status: string;
	introducedOrder?: number;
	relevantPersonaIds?: string[];
	spokenPersonaIds?: string[];
};
const seedCoverage = (
	turns: Array<Record<string, unknown>>,
	discussionPoints: string[],
	discussionPointStatuses: SeedStatus[]
) => {
	holder.mock = createFirestoreMock();
	holder.mock.store.set(`topics/${TOPIC_ID}`, {
		phase: 'debate',
		phaseStatus: 'running',
		runId: RUN_ID,
		title: 'T'
	});
	holder.mock.store.set(`topics/${TOPIC_ID}/chapters/ch1`, {
		chapterIndex: 0,
		title: '章0',
		discussionPoints,
		turns,
		status: 'running',
		discussionPointStatuses
	});
	stepQueue.length = 0;
	enqueuedKeys.clear();
};

const persistedStatuses = (): SeedStatus[] =>
	(holder.mock!.store.get(`topics/${TOPIC_ID}/chapters/ch1`)?.discussionPointStatuses ??
		[]) as SeedStatus[];

describe('カバレッジ・ゲート結合（6.2）', () => {
	it('未発言の関連参加者が残る間は次論点が introduced 化されず引き込み介入のみ保存される', async () => {
		seedCoverage(
			chainTurns(5),
			['論点A', '論点B'],
			[
				{
					point: '論点A',
					status: 'introduced',
					introducedOrder: 1,
					relevantPersonaIds: ['p1', 'p2'],
					spokenPersonaIds: ['p1']
				},
				{ point: '論点B', status: 'untouched' }
			]
		);
		// LLM は論点投入（index 0 = 論点B）を返すが、未発言 p2 が残るためゲートが前進を阻止し引き込みに留める
		mockEvaluateTopicDrift.mockResolvedValue({
			ok: true,
			value: { content: 'p2さんはどう？', targetPersonaId: 'p2', selectedDiscussionPointIndex: 0 }
		});

		await advanceDebate(turnPayload(6));

		const turns = chapterTurns();
		expect(turns).toHaveLength(7);
		expect(turns[6].speakerType).toBe('facilitator'); // ファシリテーターのみ保存（応答は次ターン）
		expect(mockGenerateTurn).not.toHaveBeenCalled();
		expect(persistedStatuses().find((s) => s.point === '論点B')?.status).toBe('untouched');
	});

	it('引き込み先が未発言の関連参加者でない介入は採用せず指名先が応答する', async () => {
		seedCoverage(
			chainTurns(5),
			['論点A', '論点B'],
			[
				{
					point: '論点A',
					status: 'introduced',
					introducedOrder: 1,
					relevantPersonaIds: ['p1', 'p2'],
					spokenPersonaIds: ['p1']
				},
				{ point: '論点B', status: 'untouched' }
			]
		);
		// 指名先 p1 は発言済み（未発言 [p2] に属さない）→ 不採用、通常フローへ
		mockEvaluateTopicDrift.mockResolvedValue({
			ok: true,
			value: { content: 'p1さん再度', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 }
		});

		await advanceDebate(turnPayload(6));

		const turns = chapterTurns();
		expect(turns[6].speakerType).toBe('persona');
		expect(persistedStatuses().find((s) => s.point === '論点B')?.status).toBe('untouched');
	});

	it('関連参加者が全員表明済みなら次論点への前進が起こり関連参加者が記録される', async () => {
		seedCoverage(
			chainTurns(5),
			['論点A', '論点B'],
			[
				{
					point: '論点A',
					status: 'introduced',
					introducedOrder: 1,
					relevantPersonaIds: ['p1', 'p2'],
					spokenPersonaIds: ['p1', 'p2']
				},
				{ point: '論点B', status: 'untouched' }
			]
		);
		// 未発言者なし → ゲート不活性。論点投入が成立する
		mockEvaluateTopicDrift.mockResolvedValue({
			ok: true,
			value: {
				content: '論点Bへ移ります',
				targetPersonaId: 'p2',
				selectedDiscussionPointIndex: 0,
				relevantPersonaIds: ['p1']
			}
		});

		await advanceDebate(turnPayload(6));

		const pointB = persistedStatuses().find((s) => s.point === '論点B');
		expect(pointB?.status).toBe('introduced');
		expect(pointB?.relevantPersonaIds).toEqual(['p1']);
		expect(pointB?.spokenPersonaIds).toEqual([]);
	});

	it('resume 後の発言者記録は集合のため二重化しない', async () => {
		seedCoverage(
			chainTurns(5),
			['論点A'],
			[
				{
					point: '論点A',
					status: 'introduced',
					introducedOrder: 1,
					relevantPersonaIds: ['p2'],
					spokenPersonaIds: ['p2']
				}
			]
		);
		// drift 見送り → 指名先 p2（既に発言済み）が応答する

		await advanceDebate(turnPayload(6));

		const turns = chapterTurns();
		expect(turns[6].speakerType).toBe('persona');
		expect(turns[6].personaId).toBe('p2');
		// 既に記録済みの p2 を再記録しても集合は二重化しない
		expect(persistedStatuses().find((s) => s.point === '論点A')?.spokenPersonaIds).toEqual(['p2']);
	});
});

describe('回帰: drift 非発火でもハードキャップで終端する', () => {
	it('ペルソナが相互指名し続け drift が一度も発火しなくても討論はハードキャップで終端する', async () => {
		// 章を pending で用意し open ステップから全チェーンを駆動する
		holder.mock = createFirestoreMock();
		holder.mock.store.set(`topics/${TOPIC_ID}`, {
			phase: 'debate',
			phaseStatus: 'running',
			runId: RUN_ID,
			title: 'T'
		});
		holder.mock.store.set(`topics/${TOPIC_ID}/chapters/ch1`, {
			chapterIndex: 0,
			title: '章0',
			discussionPoints: [],
			turns: [],
			status: 'pending'
		});
		stepQueue.length = 0;
		enqueuedKeys.clear();

		// 各ペルソナは相手を指名し続ける（指名チェーンが途切れない）
		mockGenerateTurn.mockImplementation(async (persona: { id: string }) => ({
			ok: true,
			value: {
				content: 'turn',
				speechMode: 'question',
				beliefChange: null,
				targetPersonaId: persona.id === 'p1' ? 'p2' : 'p1'
			}
		}));
		// drift / stall は常に見送り（介入は一切発火しない）

		stepQueue.push({
			topicId: TOPIC_ID,
			chapterIndex: 0,
			runId: RUN_ID,
			stepKind: 'open',
			expectedTurnIndex: 0
		});
		let guard = 0;
		while (stepQueue.length > 0 && guard++ < 2000) {
			await advanceDebate(stepQueue.shift()!);
		}

		// ガード到達前に自然終端し、討論はハードキャップで完了している
		expect(guard).toBeLessThan(2000);
		expect(holder.mock.store.get(`topics/${TOPIC_ID}`)?.phaseStatus).toBe('generated');
		expect(chapterTurns().length).toBeLessThanOrEqual(MAX_TURNS);
	});
});
