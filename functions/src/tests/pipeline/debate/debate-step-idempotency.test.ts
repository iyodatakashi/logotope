/**
 * 冪等性・liveness の統合テスト（Task 6.1）。
 * インメモリ Firestore 上で advanceDebate を直接駆動し、重複・部分失敗シナリオで
 * ターン数と終端が一意になること、リトライ/重複タスクが resume でチェーンを復活させることを検証する。
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
	return { nanoid: () => `id-${n++}` };
});

vi.mock('../../../agents/persona-agent.js', () => ({
	generateTurn: vi.fn(async () => ({
		ok: true,
		value: { content: 'turn', speechMode: 'opinion', beliefChange: null }
	})),
	generateImpression: vi.fn(async () => ({ ok: true, value: { content: 'comment' } }))
}));
vi.mock('../../../agents/facilitator-agent.js', () => ({
	generateOpening: vi.fn(async () => ({ ok: true, value: { content: 'opening' } })),
	generateChapterIntroduction: vi.fn(async () => ({ ok: true, value: { content: 'intro' } })),
	generateChapterSummary: vi.fn(async () => ({ ok: true, value: 'summary' })),
	generateOutro: vi.fn(async () => ({ ok: true, value: 'closing' })),
	assessActiveAgendaItem: vi.fn(async () => ({ ok: true, value: { verdict: 'ongoing' } })),
	generateInterventionUtterance: vi.fn(async () => ({
		ok: true,
		value: { content: '介入', targetPersonaId: 'p2' }
	}))
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

const TOPIC_ID = 'topic1';
const RUN_ID = 'run1';

const seed = () => {
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
		turns: [{ id: 'opening', speakerType: 'facilitator', content: 'opening', createdAt: 'TS' }],
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

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Math, 'random').mockReturnValue(0);
	seed();
});

describe('冪等性: 同一期待位置の二重処理', () => {
	it('同一 expectedTurnIndex で2回処理してもターンは1件しか増えない（2回目は生成せず resume）', async () => {
		const before = chapterTurns().length; // 1 (opening)
		await advanceDebate(turnPayload(1)); // index 1 を生成 → 2件
		const afterFirst = chapterTurns().length;
		expect(afterFirst).toBe(before + 1);

		// 2回目: 同じ expectedTurnIndex=1 だが章 doc は既に index 2 → frontier 不一致で生成しない
		await advanceDebate(turnPayload(1));
		expect(chapterTurns().length).toBe(afterFirst);
	});
});

describe('liveness: 追記コミット済みだが次 enqueue 前にクラッシュ', () => {
	it('リトライ/重複タスクが resume で後続ステップを投入しチェーンが復活する', async () => {
		// 1回目: index 1 を生成・追記（成功）。これで章 doc は index 2 まで進む
		await advanceDebate(turnPayload(1));
		const len = chapterTurns().length;
		// 「次 enqueue 前にクラッシュ」を模して enqueue 履歴をクリア
		stepQueue.length = 0;
		enqueuedKeys.clear();

		// リトライ（同一ペイロード）: frontier 不一致 → 生成せず、最新状態から次ステップを resume 投入
		await advanceDebate(turnPayload(1));
		expect(chapterTurns().length).toBe(len); // ターンは増えない
		expect(stepQueue.length).toBeGreaterThan(0); // 後続ステップが投入されチェーン復活
		expect(stepQueue[0].expectedTurnIndex).toBe(len); // 次の frontier を指している
	});
});

describe('終端冪等: 最終章 chapter-end', () => {
	const chapterEndPayload: StepPayload = {
		topicId: TOPIC_ID,
		chapterIndex: 0,
		runId: RUN_ID,
		stepKind: 'chapter-end',
		expectedTurnIndex: 1
	};

	it('最終章 chapter-end でコメント生成なしに phaseStatus が running→generated へ遷移する', async () => {
		await advanceDebate(chapterEndPayload);

		// 章は completed 化され、討論後コメントは生成されない（生成は編集工程へ移設）
		expect(holder.mock!.store.get(`topics/${TOPIC_ID}/chapters/ch1`)?.status).toBe('completed');
		expect(holder.mock!.store.get(`topics/${TOPIC_ID}/postDebateComments/0`)).toBeUndefined();
		expect(holder.mock!.store.get(`topics/${TOPIC_ID}`)?.phaseStatus).toBe('generated');
	});

	it('章末を重複適用しても状態が壊れない（generated 冪等・次ステップを投入しない）', async () => {
		await advanceDebate(chapterEndPayload);
		await advanceDebate(chapterEndPayload);

		expect(holder.mock!.store.get(`topics/${TOPIC_ID}`)?.phaseStatus).toBe('generated');
		// 最終章の終端では後続ステップ（次章 open 等）を投入しない
		expect(stepQueue).toHaveLength(0);
	});
});

describe('committed-no-turn: 最後の論点消化で章がその場で終了する（Task 5）', () => {
	it('最後の論点が出尽くしになると、余計な発言なしに章が completed 化し generated 確定する', async () => {
		// 論点A のみ・introduced（active）で未提示なし。末尾に未応答指名なし・クールダウン充足（persona×3）。
		const turns = [
			{ id: 'opening', speakerType: 'facilitator', content: 'opening', createdAt: 'TS' },
			{ id: 't1', speakerType: 'persona', personaId: 'p1', content: '1', createdAt: 'TS' },
			{ id: 't2', speakerType: 'persona', personaId: 'p2', content: '2', createdAt: 'TS' },
			{ id: 't3', speakerType: 'persona', personaId: 'p1', content: '3', createdAt: 'TS' }
		];
		holder.mock!.store.set(`topics/${TOPIC_ID}/chapters/ch1`, {
			chapterIndex: 0,
			title: '章0',
			agenda: ['論点A'],
			agendaItemStatuses: [{ point: '論点A', status: 'introduced', introducedOrder: 1 }],
			turns,
			status: 'running'
		});
		stepQueue.length = 0;
		enqueuedKeys.clear();

		// active 論点は出尽くし判定・意欲は低（高意欲ゲートを通す）
		const fac = await import('../../../agents/facilitator-agent.js');
		vi.mocked(fac.assessActiveAgendaItem).mockResolvedValueOnce({
			ok: true,
			value: { verdict: 'exhausted' }
		});
		const eng = await import('../../../pipeline/debate/engagement.js');
		vi.mocked(eng.evaluateEngagements).mockResolvedValueOnce([
			{ personaId: 'p1', score: 1, mode: 'none' },
			{ personaId: 'p2', score: 1, mode: 'none' }
		] as never);

		const before = chapterTurns().length; // 4
		await advanceDebate(turnPayload(4));

		// 余計なペルソナ発言を追記しない（committed-no-turn）
		expect(chapterTurns().length).toBe(before);
		// 章はその場で completed 化し、討論は generated 確定する（盛り上がり不問で一気通貫）
		expect(holder.mock!.store.get(`topics/${TOPIC_ID}/chapters/ch1`)?.status).toBe('completed');
		expect(holder.mock!.store.get(`topics/${TOPIC_ID}`)?.phaseStatus).toBe('generated');
	});
});
