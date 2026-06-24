/**
 * 新 per-turn チェーン（advanceDebate）の行動ゴールデンテスト（Task 6.2 由来）。
 * もとは旧 while ループ版との等価性ハーネスとして両版のターン列一致を検証していた（パリティ確認済み）。
 * 旧ループ撤去（7.1）後は、スクリプト化したモック上で新チェーンを駆動し、代表シナリオの
 * ターン列（話者・モード・指名・キュー・順序）をスナップショットとして固定し回帰を検出する。
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

// --- スクリプト化エージェント ---
const mockGenerateTurn = vi.fn();
vi.mock('../../../agents/persona-agent.js', () => ({
	generateTurn: (...a: unknown[]) => mockGenerateTurn(...a),
	generatePostDebateComment: vi.fn(async () => ({ ok: true, value: { content: 'comment' } }))
}));

const mockEvaluateTopicDrift = vi.fn();
const mockEvaluateStallIntervention = vi.fn();
const mockEvaluateCoverage = vi.fn();
vi.mock('../../../agents/facilitator-agent.js', () => ({
	generateOpening: vi.fn(async () => ({ ok: true, value: { content: 'opening' } })),
	generateChapterIntroduction: vi.fn(async () => ({ ok: true, value: { content: 'intro' } })),
	generateChapterSummary: vi.fn(async () => ({ ok: true, value: 'summary' })),
	generateClosing: vi.fn(async () => ({ ok: true, value: 'closing' })),
	evaluateTopicDrift: (...a: unknown[]) => mockEvaluateTopicDrift(...a),
	evaluateStallIntervention: (...a: unknown[]) => mockEvaluateStallIntervention(...a),
	evaluateDiscussionPointCoverage: (...a: unknown[]) => mockEvaluateCoverage(...a)
}));

const mockEvaluateEngagements = vi.fn();
vi.mock('../../../pipeline/debate/engagement.js', () => ({
	evaluateEngagements: (...a: unknown[]) => mockEvaluateEngagements(...a),
	evaluateEngagementWithFallback: vi.fn(async ({ personaId }: { personaId: string }) => ({
		personaId,
		score: 5,
		mode: 'opinion'
	}))
}));

vi.mock('../../../pipeline/topics/topics.js', () => ({
	getTopicById: vi.fn(async () => ({ id: 'topic1', title: 'テストテーマ' }))
}));

const mockPersonas = [
	{ id: 'p1', name: 'A', approved: true, beliefs: [] },
	{ id: 'p2', name: 'B', approved: true, beliefs: [] }
];
vi.mock('../../../pipeline/personas/personas.js', () => ({
	getPersonasByTopicId: vi.fn(async () => mockPersonas)
}));

// --- enqueue モック（新チェーン駆動用のキュー） ---
const stepQueue: StepPayload[] = [];
const enqueuedKeys = new Set<string>();
vi.mock('../../../pipeline/debate/enqueue-step.js', () => ({
	taskKey: (p: { runId: string; chapterId: string; frontierIndex: number | 'comments' }) =>
		`${p.runId}:${p.chapterId}:${p.frontierIndex}`,
	hashTaskId: (k: string) => k,
	enqueueStep: async (payload: StepPayload, key: string) => {
		if (enqueuedKeys.has(key)) return; // dedup（task-already-exists 相当）
		enqueuedKeys.add(key);
		stepQueue.push(payload);
	}
}));

import { advanceDebate } from '../../../pipeline/debate/debate-orchestrator.js';

const TOPIC_ID = 'topic1';
const RUN_ID = 'run1';

type SeedChapter = { id: string; chapterIndex: number; discussionPoints: string[] };

const seedStore = (chapters: SeedChapter[]) => {
	holder.mock = createFirestoreMock();
	holder.mock.store.set(`topics/${TOPIC_ID}`, {
		phase: 5,
		phaseStatus: 'running',
		runId: RUN_ID,
		title: 'テストテーマ'
	});
	for (const ch of chapters) {
		holder.mock.store.set(`topics/${TOPIC_ID}/chapters/${ch.id}`, {
			chapterIndex: ch.chapterIndex,
			title: `章${ch.chapterIndex}`,
			focusQuestion: '?',
			discussionPoints: ch.discussionPoints,
			turns: [],
			status: 'pending'
		});
	}
};

type TurnTuple = {
	speakerType: string;
	personaId: string | null;
	targetPersonaId: string | null;
	fromQueue: boolean;
};

const collectTurns = (): TurnTuple[] => {
	const result: TurnTuple[] = [];
	const chapterPaths = [...holder.mock!.store.keys()]
		.filter((k) => /^topics\/topic1\/chapters\/[^/]+$/.test(k))
		.sort(
			(a, b) =>
				((holder.mock!.store.get(a)?.chapterIndex as number) ?? 0) -
				((holder.mock!.store.get(b)?.chapterIndex as number) ?? 0)
		);
	for (const p of chapterPaths) {
		const turns = (holder.mock!.store.get(p)?.turns ?? []) as Array<Record<string, unknown>>;
		for (const t of turns) {
			result.push({
				speakerType: t.speakerType as string,
				personaId: (t.personaId as string) ?? null,
				targetPersonaId: (t.targetPersonaId as string) ?? null,
				fromQueue: (t.fromQueue as boolean) ?? false
			});
		}
	}
	return result;
};

const runNewChain = async (chapters: SeedChapter[]): Promise<TurnTuple[]> => {
	seedStore(chapters);
	stepQueue.length = 0;
	enqueuedKeys.clear();
	stepQueue.push({
		topicId: TOPIC_ID,
		chapterIndex: 0,
		runId: RUN_ID,
		stepKind: 'open',
		expectedTurnIndex: 0
	});
	let guard = 0;
	while (stepQueue.length > 0 && guard++ < 2000) {
		const payload = stepQueue.shift()!;
		await advanceDebate(payload);
	}
	return collectTurns();
};

describe('行動等価性: 旧 while ループ vs 新 per-turn チェーン', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// selectSpeaker の同点タイブレークは Math.random を使うため、等価性検証では固定する
		vi.spyOn(Math, 'random').mockReturnValue(0);
		mockEvaluateEngagements.mockImplementation(async () => [
			{ personaId: 'p1', score: 5, mode: 'opinion' },
			{ personaId: 'p2', score: 5, mode: 'opinion' }
		]);
		mockGenerateTurn.mockImplementation(async () => ({
			ok: true,
			value: { content: 'turn', speechMode: 'opinion', beliefChange: null }
		}));
		mockEvaluateTopicDrift.mockResolvedValue({ ok: true, value: { content: undefined } });
		mockEvaluateStallIntervention.mockResolvedValue({ ok: true, value: { content: undefined } });
		mockEvaluateCoverage.mockResolvedValue({ ok: true, value: [] });
	});

	it('論点なし単一章: ターン列ゴールデン', async () => {
		const chapters: SeedChapter[] = [{ id: 'ch1', chapterIndex: 0, discussionPoints: [] }];
		const seq = await runNewChain(chapters);
		expect(seq.length).toBeGreaterThan(0);
		// 各 index に1ターンのみ・終端まで進む（重複なし）
		expect(seq).toMatchSnapshot();
	});

	it('論点なし複数章: 章遷移を含むターン列ゴールデン', async () => {
		const chapters: SeedChapter[] = [
			{ id: 'ch1', chapterIndex: 0, discussionPoints: [] },
			{ id: 'ch2', chapterIndex: 1, discussionPoints: [] }
		];
		const seq = await runNewChain(chapters);
		expect(seq).toMatchSnapshot();
	});

	it('論点あり単一章（カバレッジ評価経路）: ターン列ゴールデン', async () => {
		const chapters: SeedChapter[] = [
			{ id: 'ch1', chapterIndex: 0, discussionPoints: ['論点A', '論点B'] }
		];
		// 低意欲を返して早期終了カウンタを進め、カバレッジ評価を発火させる
		mockEvaluateEngagements.mockImplementation(async () => [
			{ personaId: 'p1', score: 2, mode: 'opinion' },
			{ personaId: 'p2', score: 2, mode: 'opinion' }
		]);
		mockEvaluateCoverage.mockResolvedValue({ ok: true, value: [0, 1] });
		const seq = await runNewChain(chapters);
		expect(seq).toMatchSnapshot();
	});

	it('指名（直接質問）が連続する章: +1 最終応答を含むターン列ゴールデン', async () => {
		const chapters: SeedChapter[] = [{ id: 'ch1', chapterIndex: 0, discussionPoints: [] }];
		// 各ペルソナが相手を指名し続ける → 指名駆動の順序＋章末 +1 応答を再現
		mockGenerateTurn.mockImplementation(async (persona: { id: string }) => ({
			ok: true,
			value: {
				content: 'turn',
				speechMode: 'question',
				beliefChange: null,
				targetPersonaId: persona.id === 'p1' ? 'p2' : 'p1'
			}
		}));
		const seq = await runNewChain(chapters);
		// 章末に最終応答（+1）が高々1回だけ挟まることを確認
		expect(seq).toMatchSnapshot();
	});

	it('介入が発火する章: ファシリテーター介入を含むターン列ゴールデン', async () => {
		const chapters: SeedChapter[] = [{ id: 'ch1', chapterIndex: 0, discussionPoints: ['論点A'] }];
		// 低意欲 → スタール介入が発火する
		mockEvaluateEngagements.mockImplementation(async () => [
			{ personaId: 'p1', score: 1, mode: 'none' },
			{ personaId: 'p2', score: 1, mode: 'none' }
		]);
		mockEvaluateStallIntervention.mockResolvedValue({
			ok: true,
			value: {
				content: '介入',
				targetPersonaId: undefined,
				selectedDiscussionPointIndex: undefined
			}
		});
		const seq = await runNewChain(chapters);
		expect(seq).toMatchSnapshot();
	});
});
