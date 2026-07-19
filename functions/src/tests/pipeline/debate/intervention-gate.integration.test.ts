/**
 * アジェンダ進行一本化（agenda-progression-unification）の結合テスト。
 * インメモリ Firestore 上で advanceDebate を 1 ステップ駆動し、末尾指名状態に関わらず単一クールダウンで
 * 3値判定が1回走ること（2.2）・exhausted が指名チェーンに封じられず前進すること（1.1）・
 * 旧形式カバレッジフィールドを含む章からの復元と続行（4.4）・ハードキャップ終端（5.3）を検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { StepPayload } from '../../../types/step.types.js';

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

const mockAssessAgenda = vi.fn();
const mockGenerateUtterance = vi.fn();
vi.mock('../../../agents/facilitator-agent.js', () => ({
	generateOpening: vi.fn(async () => ({ ok: true, value: { content: 'opening' } })),
	generateChapterIntroduction: vi.fn(async () => ({ ok: true, value: { content: 'intro' } })),
	assessActiveAgendaItem: (...a: unknown[]) => mockAssessAgenda(...a),
	generateInterventionUtterance: (...a: unknown[]) => mockGenerateUtterance(...a)
}));

const mockEvaluateEngagements = vi.fn(async () => [
	{ personaId: 'p1', score: 5, mode: 'opinion' },
	{ personaId: 'p2', score: 5, mode: 'opinion' }
]);
vi.mock('../../../pipeline/debate/engagement.js', () => ({
	evaluateEngagements: (...a: unknown[]) => mockEvaluateEngagements(...a),
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
		{ id: 'p1', name: 'A', selected: true, beliefs: [] },
		{ id: 'p2', name: 'B', selected: true, beliefs: [] }
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
import { TURNS_PER_CHAPTER, TURN_CAP_RATIO } from '../../../constants/debate.constants.js';

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
		agenda: ['論点A'],
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
	// 既定は「継続（ongoing）＝介入しない」。個々のテストで exhausted/drifted を上書きする。
	mockAssessAgenda.mockResolvedValue({ ok: true, value: { verdict: 'ongoing' } });
	mockGenerateUtterance.mockResolvedValue({
		ok: true,
		value: { content: '介入', targetPersonaId: 'p2' }
	});
	mockEvaluateEngagements.mockResolvedValue([
		{ personaId: 'p1', score: 5, mode: 'opinion' },
		{ personaId: 'p2', score: 5, mode: 'opinion' }
	]);
});

// opening(facilitator) + 指名を伴わないペルソナ発言 count 件（末尾が非指名 → no-target トリガー）
const noTargetTurns = (count: number): Array<Record<string, unknown>> => {
	const turns: Array<Record<string, unknown>> = [
		{ id: 'opening', speakerType: 'facilitator', content: 'opening', createdAt: 'TS' }
	];
	for (let i = 0; i < count; i++) {
		turns.push({
			id: `t${i + 1}`,
			speakerType: 'persona',
			personaId: i % 2 === 0 ? 'p1' : 'p2',
			content: '発言',
			createdAt: 'TS',
			speechMode: 'opinion'
		});
	}
	return turns;
};

describe('末尾指名状態に関わらず単一クールダウンで3値判定が1回走る（2.2）', () => {
	// chainTurns(5) = opening + ペルソナ指名 5 件。ペルソナターン 5 ≥ 既定クールダウン 3 で評価対象。expectedTurnIndex=6
	it('ペルソナ指名チェーン中でも exhausted なら前進する（チェーンは前進を封じない・1.1）', async () => {
		seedCoverage(
			chainTurns(5),
			['論点A', '論点B'],
			[
				{ point: '論点A', status: 'introduced', introducedOrder: 1 },
				{ point: '論点B', status: 'untouched' }
			]
		);
		mockAssessAgenda.mockResolvedValue({ ok: true, value: { verdict: 'exhausted' } });
		mockGenerateUtterance.mockResolvedValue({
			ok: true,
			value: { content: '論点Bへ移ります', targetPersonaId: 'p2', selectedAgendaItemIndex: 0 }
		});

		await advanceDebate(turnPayload(6));

		// 指名チェーン中でも判定は1回走り、前進元 A が addressed・未提示 B が introduced になる
		expect(mockAssessAgenda).toHaveBeenCalledTimes(1);
		expect(persistedStatuses().find((s) => s.point === '論点A')?.status).toBe('addressed');
		expect(persistedStatuses().find((s) => s.point === '論点B')?.status).toBe('introduced');
		const turns = chapterTurns();
		expect(turns[6].speakerType).toBe('facilitator'); // 司会のみ保存（応答は次ターン）
		expect(mockGenerateTurn).not.toHaveBeenCalled();
	});

	it('引き戻し（drifted）はファシリテーターのみ保存し、同ステップでペルソナ応答を生成しない（3.1）', async () => {
		seedChapter(chainTurns(5));
		mockAssessAgenda.mockResolvedValue({ ok: true, value: { verdict: 'drifted' } });
		mockGenerateUtterance.mockResolvedValue({
			ok: true,
			value: { content: '本題に戻しましょう', targetPersonaId: 'p2' }
		});

		await advanceDebate(turnPayload(6));

		const turns = chapterTurns();
		expect(turns).toHaveLength(7);
		expect(turns[6].speakerType).toBe('facilitator');
		expect(mockGenerateTurn).not.toHaveBeenCalled();
	});

	it('判定が継続（ongoing）なら指名先（直前ターンの target）が応答する（2.4）', async () => {
		seedChapter(chainTurns(5));
		// 既定の ongoing（介入しない）

		await advanceDebate(turnPayload(6));

		const turns = chapterTurns();
		expect(mockAssessAgenda).toHaveBeenCalledTimes(1);
		expect(turns[6].speakerType).toBe('persona');
		expect(turns[6].personaId).toBe('p2');
	});
});

describe('クールダウン未達・ファシリテーター発言直後は判定を呼ばない（2.1）', () => {
	it('ペルソナターンがクールダウン未満（2 < 3）のうちは判定を呼ばず指名先が応答する', async () => {
		seedChapter(chainTurns(2)); // ペルソナ指名 2 件 → 2 < 3 で評価対象外。expectedTurnIndex=3
		mockAssessAgenda.mockResolvedValue({ ok: true, value: { verdict: 'drifted' } });

		await advanceDebate(turnPayload(3));

		const turns = chapterTurns();
		expect(mockAssessAgenda).not.toHaveBeenCalled();
		expect(turns[3].speakerType).toBe('persona');
		expect(turns[3].personaId).toBe('p1');
	});

	it('末尾が facilitator 発言（ターン数 0）なら判定を呼ばず指名先が応答する', async () => {
		seedChapter([...chainTurns(5), facilitatorTarget('f2', 'p1')]); // 末尾 facilitator 指名。expectedTurnIndex=7
		mockAssessAgenda.mockResolvedValue({ ok: true, value: { verdict: 'drifted' } });

		await advanceDebate(turnPayload(7));

		const turns = chapterTurns();
		expect(mockAssessAgenda).not.toHaveBeenCalled();
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
	agenda: string[],
	agendaItemStatuses: SeedStatus[]
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
		agenda,
		turns,
		status: 'running',
		agendaItemStatuses
	});
	stepQueue.length = 0;
	enqueuedKeys.clear();
};

const persistedStatuses = (): SeedStatus[] =>
	(holder.mock!.store.get(`topics/${TOPIC_ID}/chapters/ch1`)?.agendaItemStatuses ??
		[]) as SeedStatus[];

describe('互換: 旧形式カバレッジフィールドを含む章からの復元と続行（4.4）', () => {
	it('旧形式フィールド（spoken/relevant）が残る章でもエラーなく続行し、判定継続で指名先が応答する', async () => {
		seedCoverage(
			chainTurns(5),
			['論点A'],
			[
				{
					point: '論点A',
					status: 'introduced',
					introducedOrder: 1,
					relevantPersonaIds: ['p1', 'p2'],
					spokenPersonaIds: ['p1']
				}
			]
		);
		// 既定の ongoing（介入しない）。旧フィールドは復元されるが参照されず無害

		await advanceDebate(turnPayload(6));

		const turns = chapterTurns();
		expect(turns[6].speakerType).toBe('persona');
		expect(turns[6].personaId).toBe('p2');
	});

	it('前進時の永続で旧形式カバレッジフィールドが除去される（自然消滅）', async () => {
		seedCoverage(
			noTargetTurns(5),
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
		mockAssessAgenda.mockResolvedValue({ ok: true, value: { verdict: 'exhausted' } });
		mockGenerateUtterance.mockResolvedValue({
			ok: true,
			value: { content: '論点Bへ移ります', targetPersonaId: 'p2', selectedAgendaItemIndex: 0 }
		});

		await advanceDebate(turnPayload(6));

		const pointA = persistedStatuses().find((s) => s.point === '論点A');
		const pointB = persistedStatuses().find((s) => s.point === '論点B');
		// 前進元 A は addressed、次論点 B は introduced
		expect(pointA?.status).toBe('addressed');
		expect(pointB?.status).toBe('introduced');
		// 旧形式フィールドは書き出されない（次回保存で自然消滅・4.4）
		expect(pointA?.spokenPersonaIds).toBeUndefined();
		expect(pointA?.relevantPersonaIds).toBeUndefined();
		expect(pointB?.spokenPersonaIds).toBeUndefined();
		expect(pointB?.relevantPersonaIds).toBeUndefined();
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
			agenda: [],
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

		// ガード到達前に自然終端し、討論は章キャップで完了している（全体上限は廃止済み）
		expect(guard).toBeLessThan(2000);
		expect(holder.mock.store.get(`topics/${TOPIC_ID}`)?.phaseStatus).toBe('generated');
		// 論点なし章の cap（ceil(15*1.5)=23）＋末尾指名への最終応答 1 で頭打ちになる
		expect(chapterTurns().length).toBeLessThanOrEqual(
			Math.ceil(TURNS_PER_CHAPTER * TURN_CAP_RATIO) + 1
		);
	});
});
