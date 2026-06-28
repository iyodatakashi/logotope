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
	generatePostDebateComment: vi.fn(async () => ({ ok: true, value: { content: 'comment' } }))
}));
vi.mock('../../../agents/facilitator-agent.js', () => ({
	generateOpening: vi.fn(async () => ({ ok: true, value: { content: 'opening' } })),
	generateChapterIntroduction: vi.fn(async () => ({ ok: true, value: { content: 'intro' } })),
	generateChapterSummary: vi.fn(async () => ({ ok: true, value: 'summary' })),
	generateClosing: vi.fn(async () => ({ ok: true, value: 'closing' })),
	evaluateTopicDrift: vi.fn(async () => ({ ok: true, value: { content: undefined } })),
	evaluateStallIntervention: vi.fn(async () => ({ ok: true, value: { content: undefined } })),
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

const TOPIC_ID = 'topic1';
const RUN_ID = 'run1';

const seed = () => {
	holder.mock = createFirestoreMock();
	holder.mock.store.set(`topics/${TOPIC_ID}`, {
		phase: 5,
		phaseStatus: 'running',
		runId: RUN_ID,
		title: 'T'
	});
	holder.mock.store.set(`topics/${TOPIC_ID}/chapters/ch1`, {
		chapterIndex: 0,
		title: '章0',
		discussionPoints: [],
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

describe('終端冪等: comments ステップ', () => {
	const commentsPayload: StepPayload = {
		topicId: TOPIC_ID,
		chapterIndex: 0,
		runId: RUN_ID,
		stepKind: 'comments',
		expectedTurnIndex: -1
	};

	it('comments を2回実行しても postDebateComments は1セット・phaseStatus は二重遷移しない', async () => {
		await advanceDebate(commentsPayload);
		const firstComments = holder.mock!.store.get(`topics/${TOPIC_ID}/postDebateComments/0`);
		expect(firstComments).toBeDefined();
		expect(holder.mock!.store.get(`topics/${TOPIC_ID}`)?.phaseStatus).toBe('generated');

		// 2回目: phaseStatus は既に generated → running ガードで遷移しない（no-op）
		await advanceDebate(commentsPayload);
		expect(holder.mock!.store.get(`topics/${TOPIC_ID}`)?.phaseStatus).toBe('generated');
		const comments = holder.mock!.store.get(`topics/${TOPIC_ID}/postDebateComments/0`) as {
			comments: unknown[];
		};
		expect(comments.comments).toHaveLength(2); // ペルソナ2人分のみ（重複なし）
	});
});
