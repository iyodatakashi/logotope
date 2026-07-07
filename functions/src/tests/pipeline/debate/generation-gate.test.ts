/**
 * 討論チェーンの世代照合（R9）の統合テスト。
 * インメモリ Firestore 上で advanceDebate を直接駆動し、
 * - 入口ゲート: 旧世代 payload は全ステップ種別で副作用ゼロ・再エンキューなしで正常終了する（R9.1）
 * - 棄却理由の伝播: 生成中の世代交代は addTurn が弾き resume しない／並走敗者は従来どおり resume する（R9.2/9.3）
 * ことを検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { StepPayload, StepKind } from '../../../types/step.types.js';

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
import { generateTurn } from '../../../agents/persona-agent.js';

const TOPIC_ID = 'topic1';
const CURRENT_RUN = 'run-current';
const TOPIC_PATH = `topics/${TOPIC_ID}`;
const CHAPTER_PATH = `topics/${TOPIC_ID}/chapters/ch1`;

const seed = () => {
	holder.mock = createFirestoreMock();
	holder.mock.store.set(TOPIC_PATH, {
		phase: 'debate',
		phaseStatus: 'running',
		runId: CURRENT_RUN,
		title: 'T'
	});
	holder.mock.store.set(CHAPTER_PATH, {
		chapterIndex: 0,
		title: '章0',
		discussionPoints: [],
		turns: [{ id: 'opening', speakerType: 'facilitator', content: 'opening', createdAt: 'TS' }],
		status: 'running'
	});
	stepQueue.length = 0;
	enqueuedKeys.clear();
};

const chapterTurns = (): unknown[] =>
	(holder.mock!.store.get(CHAPTER_PATH)?.turns ?? []) as unknown[];

const payloadWithRun = (stepKind: StepKind, runId: string): StepPayload => ({
	topicId: TOPIC_ID,
	chapterIndex: 0,
	runId,
	stepKind,
	expectedTurnIndex: 1
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Math, 'random').mockReturnValue(0);
	seed();
});

describe('入口ゲート: 旧世代 payload は副作用ゼロで正常終了する（R9.1）', () => {
	const STEP_KINDS: StepKind[] = ['open', 'turn', 'chapter-end'];

	it.each(STEP_KINDS)(
		'%s ステップ: 旧 runId は生成・状態変更・再エンキューを一切行わない',
		async (kind) => {
			const beforeTurns = chapterTurns().length;
			const result = await advanceDebate(payloadWithRun(kind, 'run-OLD'));

			expect(result).toBe(false);
			// ターン追記なし・章 doc 不変
			expect(chapterTurns().length).toBe(beforeTurns);
			// phaseStatus 等の状態変更なし（comments の generated 遷移も起きない）
			expect(holder.mock!.store.get(TOPIC_PATH)?.phaseStatus).toBe('running');
			// 再エンキューなし（Cloud Tasks リトライを誘発しない）
			expect(stepQueue.length).toBe(0);
			// LLM 呼び出しなし
			expect(vi.mocked(generateTurn)).not.toHaveBeenCalled();
		}
	);

	it('現行世代 payload（runId 一致）は従来どおり処理される（ゲートは同一世代を通す）', async () => {
		const beforeTurns = chapterTurns().length;
		await advanceDebate(payloadWithRun('turn', CURRENT_RUN));
		// 同一世代なので生成・追記される（副作用がある）
		expect(chapterTurns().length).toBe(beforeTurns + 1);
	});
});

describe('棄却理由の伝播: 生成中の世代交代 vs 並走敗者（R9.2/9.3）', () => {
	it('生成中に世代交代（topic runId 変化）が起きると addTurn が弾き、resume せず終了する', async () => {
		// 入口ゲートは現行世代で通過する（payload.runId === topic.runId）。
		// 生成中（generateTurn 内）に別世代が topic.runId を書き換えた状況を模す。
		vi.mocked(generateTurn).mockImplementationOnce(async () => {
			const topic = holder.mock!.store.get(TOPIC_PATH)!;
			holder.mock!.store.set(TOPIC_PATH, { ...topic, runId: 'run-NEW' });
			return { ok: true, value: { content: 'turn', speechMode: 'opinion', beliefChange: null } };
		});

		const beforeTurns = chapterTurns().length;
		const result = await advanceDebate(payloadWithRun('turn', CURRENT_RUN));

		expect(result).toBe(false);
		// addTurn が generation_mismatch で弾くため追記なし
		expect(chapterTurns().length).toBe(beforeTurns);
		// 世代不一致は resume しない → 再エンキューなし
		expect(stepQueue.length).toBe(0);
	});

	it('並走敗者（生成中に別タスクが先に追記）は index_mismatch となり resumeFromFresh で次を投入する', async () => {
		// 生成中に別タスクが同じ frontier を先取りして章 doc を先行させた状況を模す。
		vi.mocked(generateTurn).mockImplementationOnce(async () => {
			const chapter = holder.mock!.store.get(CHAPTER_PATH)!;
			holder.mock!.store.set(CHAPTER_PATH, {
				...chapter,
				turns: [
					...(chapter.turns as unknown[]),
					{ id: 'other', speakerType: 'persona', content: 'x', createdAt: 'TS' }
				]
			});
			return { ok: true, value: { content: 'turn', speechMode: 'opinion', beliefChange: null } };
		});

		const result = await advanceDebate(payloadWithRun('turn', CURRENT_RUN));

		expect(result).toBe(false);
		// index_mismatch は従来どおり resumeFromFresh → 後続ステップが投入されチェーンが途切れない
		expect(stepQueue.length).toBeGreaterThan(0);
	});
});
