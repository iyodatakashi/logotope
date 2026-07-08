/**
 * step.ts のカバレッジ配線（5.1 / 5.2）を検証する。
 * - 5.1: 通常ターンのコミット後に現アクティブ論点へ話者を冪等記録し、saveAgendaItemStatuses で永続化する。
 * - 5.2: オープニングの論点投入で、ファシリテーター返却の関連参加者を（有効IDへフィルタして）記録する。
 * agenda.js は実物を使い、I/O 依存（agents / turn / firestore 等）のみモックする。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateState } from '../../../types/debate.types.js';
import type { DebateTurn } from '../../../types/turn.types.js';
import type { Persona } from '../../../types/persona.types.js';
import type { StepContext, StepPayload } from '../../../types/step.types.js';
import type { Chapter, ChapterEntry } from '../../../types/chapter.types.js';

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ update: mockUpdate }));
vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	Timestamp: { now: () => ({ toDate: () => new Date() }) },
	FieldValue: { delete: vi.fn(() => 'DELETE'), arrayUnion: vi.fn((...a: unknown[]) => a) }
}));

vi.mock('../../../agents/facilitator-agent.js', () => ({
	generateOpening: vi.fn(),
	generateChapterIntroduction: vi.fn()
}));
vi.mock('../../../pipeline/debate/turn.js', () => ({
	generateFacilitatorTurn: vi.fn(),
	generatePersonaTurn: vi.fn()
}));
vi.mock('../../../pipeline/debate/chapter.js', () => ({
	updateChapterStatus: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../../../pipeline/topics/topic-context.js', () => ({
	getTopicContext: vi.fn(async () => ({}))
}));
vi.mock('../../../pipeline/debate/engagement.js', () => ({
	evaluateEngagements: vi.fn().mockResolvedValue([]),
	evaluateEngagementWithFallback: vi
		.fn()
		.mockResolvedValue({ personaId: 'p1', score: 0, mode: 'none' })
}));
vi.mock('../../../pipeline/debate/speaker-selection.js', () => ({
	selectSpeaker: vi.fn(() => ({ personaId: 'p1', reason: 'score' })),
	hasHighEngagement: vi.fn(() => false)
}));
vi.mock('../../../pipeline/debate/queued-intents.js', () => ({
	expireQueuedIntents: vi.fn().mockResolvedValue(undefined),
	addQueuedIntents: vi.fn().mockResolvedValue(undefined),
	consumeQueuedIntent: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../../../pipeline/debate/debate-state.js', () => ({
	updateSpeakerStats: vi.fn()
}));
vi.mock('../../../pipeline/debate/intervention.js', () => ({
	progressAgenda: vi.fn().mockResolvedValue('none'),
	countConsecutivePersonaTargets: vi.fn(() => 0)
}));

import {
	performOpenStep,
	performTurnStep,
	completeChapterStep
} from '../../../pipeline/debate/step.js';
import { generateOpening } from '../../../agents/facilitator-agent.js';
import { updateChapterStatus } from '../../../pipeline/debate/chapter.js';
import { generateFacilitatorTurn, generatePersonaTurn } from '../../../pipeline/debate/turn.js';
import {
	evaluateEngagements,
	evaluateEngagementWithFallback
} from '../../../pipeline/debate/engagement.js';
import { progressAgenda } from '../../../pipeline/debate/intervention.js';

const personas: Persona[] = [
	{ id: 'p1', name: 'P1' } as Persona,
	{ id: 'p2', name: 'P2' } as Persona
];

const makeChapter = (agenda: string[] = []): Chapter => ({
	id: 'ch1',
	title: 'テスト章',
	agenda
});

const makeState = (
	turns: DebateTurn[] = [],
	agenda: DebateState['agenda'] = []
): DebateState => ({
	turns: [...turns],
	lastSpeakerId: undefined,
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	agenda
});

const makeCtx = (overrides: Partial<StepContext>): StepContext => {
	const chapter = (overrides.chapter as Chapter) ?? makeChapter();
	const chapterDoc = (overrides.chapterDoc as ChapterEntry) ?? {
		id: 'ch1',
		chapterIndex: 0,
		title: 'テスト章',
		agenda: chapter.agenda,
		turns: [],
		status: 'pending'
	};
	return {
		chapters: [chapterDoc],
		chapterDoc,
		chapter,
		personas,
		topicTitle: 'テーマ',
		state: makeState(),
		chapterTurnStartInState: 0,
		quietStreak: 0,
		isLastChapter: false,
		...overrides
	};
};

const makePayload = (overrides: Partial<StepPayload> = {}): StepPayload => ({
	topicId: 'topic1',
	chapterIndex: 0,
	runId: 'run1',
	stepKind: 'turn',
	expectedTurnIndex: 0,
	...overrides
});

describe('performOpenStep - 関連参加者記録の配線（5.2）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('オープニングの論点投入で、有効IDへフィルタした関連参加者を記録し発言済みを空初期化する', async () => {
		vi.mocked(generateOpening).mockResolvedValue({
			ok: true,
			value: {
				content: '問いかけ',
				targetPersonaId: 'p1',
				selectedAgendaItemIndex: 0,
				relevantPersonaIds: ['p1', 'p2', 'pX'] // pX は非参加者 → フィルタされる
			}
		});
		vi.mocked(generateFacilitatorTurn).mockResolvedValue({ status: 'committed', id: 'f1' });

		const ctx = makeCtx({ chapter: makeChapter(['論点1']) });
		await performOpenStep(ctx, makePayload({ stepKind: 'open' }));

		const active = ctx.state.agenda[0];
		expect(active.status).toBe('introduced');
		expect(active.relevantPersonaIds).toEqual(['p1', 'p2']);
		expect(active.spokenPersonaIds).toEqual([]);
	});
});

describe('performTurnStep - 早期終了間際の継続保護（非LLM・Task 4）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(generatePersonaTurn).mockResolvedValue({
			status: 'committed',
			personaId: 'p1',
			turnId: 'tn1',
			beliefChange: null,
			queuedEntries: []
		} as never);
	});

	const options = { turnsPerChapter: 4, maxTurns: 100, interventionCooldown: 2 };

	// 章ローカル3ターン（turnsPerChapter=4 → 早期閾値 ceil(3)=3）で早期終了圏に入れる
	const earlyEndCtx = (agenda: DebateState['agenda']): StepContext => {
		const turns: DebateTurn[] = [
			{ id: 't0', speakerType: 'facilitator', content: '導入', createdAt: '' },
			{ id: 't1', speakerType: 'persona', content: '1', createdAt: '' },
			{ id: 't2', speakerType: 'persona', content: '2', createdAt: '' }
		];
		const chapterDoc: ChapterEntry = {
			id: 'ch1',
			chapterIndex: 0,
			title: 'テスト章',
			agenda: agenda.map((a) => a.point),
			turns,
			status: 'running'
		};
		return makeCtx({
			chapterDoc,
			state: makeState(turns, agenda),
			chapterTurnStartInState: 0,
			quietStreak: 4 // 低意欲コミットで +1 → 5（QUIET_STREAK_LIMIT）で早期終了圏
		});
	};

	it('未消化論点が残るなら quietStreak を 0 に戻して継続する（消化判定LLMを呼ばない）', async () => {
		vi.mocked(evaluateEngagements).mockResolvedValueOnce([
			{ personaId: 'p1', score: 1, mode: 'none' }
		] as never);

		const ctx = earlyEndCtx([{ point: '論点A', status: 'introduced' }]);
		const result = await performTurnStep(
			ctx,
			makePayload({ stepKind: 'turn', expectedTurnIndex: 3 }),
			options
		);

		expect(result).toEqual({ status: 'advanced', quietStreak: 0 });
	});

	it('全論点が addressed なら継続保護は働かず早期終了カウンタを維持する', async () => {
		vi.mocked(evaluateEngagements).mockResolvedValueOnce([
			{ personaId: 'p1', score: 1, mode: 'none' }
		] as never);

		const ctx = earlyEndCtx([{ point: '論点A', status: 'addressed' }]);
		const result = await performTurnStep(
			ctx,
			makePayload({ stepKind: 'turn', expectedTurnIndex: 3 }),
			options
		);

		expect(result).toEqual({ status: 'advanced', quietStreak: 5 });
	});
});

describe('performTurnStep - 発言者記録の配線（5.1）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('通常ターンのコミット後、現アクティブ論点へ話者を記録し永続化する', async () => {
		vi.mocked(generatePersonaTurn).mockResolvedValue({
			status: 'committed',
			personaId: 'p1',
			turnId: 'tn1',
			beliefChange: null,
			queuedEntries: []
		} as never);

		// アクティブ論点C（introduced）。発言者 p1 が記録されるべき
		const state = makeState(
			[{ id: 't0', speakerType: 'facilitator', content: '導入', createdAt: '' }],
			[
				{
					point: '論点C',
					status: 'introduced',
					introducedOrder: 1,
					relevantPersonaIds: ['p1'],
					spokenPersonaIds: []
				}
			]
		);
		const chapterDoc: ChapterEntry = {
			id: 'ch1',
			chapterIndex: 0,
			title: 'テスト章',
			agenda: ['論点C'],
			turns: [{ id: 't0', speakerType: 'facilitator', content: '導入', createdAt: '' }],
			status: 'running'
		};
		const ctx = makeCtx({ chapterDoc, state, chapterTurnStartInState: 0 });

		await performTurnStep(ctx, makePayload({ stepKind: 'turn', expectedTurnIndex: 1 }), {
			turnsPerChapter: 10,
			maxTurns: 100,
			interventionCooldown: 2
		});

		expect(ctx.state.agenda[0].spokenPersonaIds).toContain('p1');
		// state ベースの書き出しで永続化される（agendaItemStatuses の update が呼ばれる）
		expect(mockUpdate).toHaveBeenCalled();
	});
});

describe('performTurnStep - 追記棄却理由の伝播（R9.2）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(evaluateEngagements).mockResolvedValue([]);
		vi.mocked(evaluateEngagementWithFallback).mockResolvedValue({
			personaId: 'p1',
			score: 0,
			mode: 'none'
		});
	});

	// frontier 一致（章 doc 0 件 = expectedTurnIndex 0）で executeTurn まで到達させる
	const runTurn = () =>
		performTurnStep(makeCtx({}), makePayload({ stepKind: 'turn', expectedTurnIndex: 0 }), {
			turnsPerChapter: 10,
			maxTurns: 100,
			interventionCooldown: 2
		});

	it('generation_mismatch は stale_generation に写像する（resume させない信号）', async () => {
		vi.mocked(generatePersonaTurn).mockResolvedValue({
			status: 'rejected',
			reason: 'generation_mismatch'
		} as never);
		expect(await runTurn()).toEqual({ status: 'stale_generation' });
	});

	it('index_mismatch（並走敗者）は conflict に写像する（従来どおり resumeFromFresh）', async () => {
		vi.mocked(generatePersonaTurn).mockResolvedValue({
			status: 'rejected',
			reason: 'index_mismatch'
		} as never);
		expect(await runTurn()).toEqual({ status: 'conflict' });
	});

	it('討論停止（skipped）は conflict に写像する', async () => {
		vi.mocked(generatePersonaTurn).mockResolvedValue({ status: 'skipped' } as never);
		expect(await runTurn()).toEqual({ status: 'conflict' });
	});
});

describe('performTurnStep - 章末+1（freeze）の指名者のみ評価（2.1）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(evaluateEngagementWithFallback).mockResolvedValue({
			personaId: 'p2',
			score: 0,
			mode: 'none'
		});
	});

	it('freeze の最終応答では一括評価（evaluateEngagements）を呼ばず、指名者のみ単独評価する', async () => {
		vi.mocked(generatePersonaTurn).mockResolvedValue({
			status: 'committed',
			personaId: 'p2',
			turnId: 'tn2',
			beliefChange: null,
			queuedEntries: []
		} as never);

		// 末尾ターンがファシリテーター指名で p2 を確定させている
		const targetedTurn: DebateTurn = {
			id: 't0',
			speakerType: 'persona',
			personaId: 'p1',
			content: '指名する',
			targetPersonaId: 'p2',
			targetedBy: 'facilitator',
			createdAt: ''
		};
		const state = makeState([targetedTurn]);
		const chapterDoc: ChapterEntry = {
			id: 'ch1',
			chapterIndex: 0,
			title: 'テスト章',
			agenda: [],
			turns: [targetedTurn],
			status: 'running'
		};
		const ctx = makeCtx({ chapterDoc, state, chapterTurnStartInState: 0 });

		await performTurnStep(
			ctx,
			makePayload({ stepKind: 'turn', expectedTurnIndex: 1, finalResponse: true }),
			{ turnsPerChapter: 10, maxTurns: 100, interventionCooldown: 2 }
		);

		// 全非話者の一括評価は行わない（2.1）
		expect(vi.mocked(evaluateEngagements)).not.toHaveBeenCalled();
		// 指名者 p2 のみ単独評価する（engagements 未指定＝一括結果に依存しない）
		expect(vi.mocked(evaluateEngagementWithFallback)).toHaveBeenCalledTimes(1);
		const callArg = vi.mocked(evaluateEngagementWithFallback).mock.calls[0][0];
		expect(callArg.personaId).toBe('p2');
		expect(callArg.engagements).toBeUndefined();
	});
});

describe('performTurnStep - 最後の論点消化のみ（committed-no-turn・Task 5）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(evaluateEngagements).mockResolvedValue([]);
	});

	it('progressAgenda が chapter-exhausted なら、ペルソナ発言を生成せず chapter-exhausted を返す', async () => {
		vi.mocked(progressAgenda).mockResolvedValueOnce('chapter-exhausted');

		// 末尾に未応答指名なし（no-target トリガー）で介入評価まで到達させる
		const opening: DebateTurn = {
			id: 't0',
			speakerType: 'facilitator',
			content: '導入',
			createdAt: ''
		};
		const state = makeState([opening], [{ point: '論点A', status: 'introduced', introducedOrder: 1 }]);
		const chapterDoc: ChapterEntry = {
			id: 'ch1',
			chapterIndex: 0,
			title: 'テスト章',
			agenda: ['論点A'],
			turns: [opening],
			status: 'running'
		};
		const ctx = makeCtx({ chapterDoc, state, chapterTurnStartInState: 0, quietStreak: 2 });

		const result = await performTurnStep(
			ctx,
			makePayload({ stepKind: 'turn', expectedTurnIndex: 1 }),
			{ turnsPerChapter: 10, maxTurns: 100, interventionCooldown: 2 }
		);

		// 余計なペルソナ発言は生成しない
		expect(vi.mocked(generatePersonaTurn)).not.toHaveBeenCalled();
		// 章終了へ渡すシグナルを返す（quietStreak は据え置く）
		expect(result).toEqual({ status: 'chapter-exhausted', quietStreak: 2 });
	});
});

describe('completeChapterStep - 章末の完了確定＋論点クリーンアップ（生成なし）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('章を completed に確定し論点状態を削除する。発言生成・turns 追記は一切行わない（1.1/2.1/3.1）', async () => {
		const chapterDoc: ChapterEntry = {
			id: 'ch1',
			chapterIndex: 0,
			title: 'テスト章',
			agenda: ['論点A'],
			turns: [{ id: 't0', speakerType: 'facilitator', content: '導入', createdAt: '' }],
			status: 'running'
		};
		const ctx = makeCtx({ chapterDoc });

		const result = await completeChapterStep(ctx, makePayload({ stepKind: 'chapter-end' }));

		expect(result).toBe(true);
		// 章 completed 確定
		expect(vi.mocked(updateChapterStatus)).toHaveBeenCalledWith('topic1', 'ch1', 'completed');
		// 論点状態クリーンアップ（agendaItemStatuses の delete で update される）
		expect(mockUpdate).toHaveBeenCalledWith({ agendaItemStatuses: 'DELETE' });
		// LLM 生成・ターン追記は一切行わない
		expect(vi.mocked(generateFacilitatorTurn)).not.toHaveBeenCalled();
		expect(vi.mocked(generatePersonaTurn)).not.toHaveBeenCalled();
	});
});
