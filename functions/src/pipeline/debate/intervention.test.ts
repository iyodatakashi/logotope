import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DebateTurn, DebateState } from '../../types/debate.types.js';

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ update: mockUpdate });

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({ doc: mockDoc })),
  Timestamp: { now: vi.fn(() => ({ toDate: () => new Date() })) },
  FieldValue: { arrayUnion: vi.fn((...args: unknown[]) => args) },
}));

import {
  shouldEvaluateIntervention,
  countPersonaTurnsSinceFacilitator,
  persistInterventionTurn,
  tryIntervention,
} from './intervention.js';

const makeTurn = (speakerType: 'persona' | 'facilitator', id: string): DebateTurn => ({
  id,
  speakerType,
  content: 'test',
  createdAt: '',
});

const makeState = (turns: DebateTurn[] = [], discussionPoints: DebateState['discussionPoints'] = []): DebateState => ({
  turns: [...turns],
  lastSpeakerId: undefined,
  silenceMap: new Map(),
  speakCount: new Map(),
  queuedIntents: new Map(),
  pairConversationTurns: 0,
  discussionPoints,
});

describe('shouldEvaluateIntervention', () => {
  it('クールダウン経過で true（毎ターン評価が原則）', () => {
    expect(shouldEvaluateIntervention(2, 2)).toBe(true);
  });

  it('クールダウン未満（ペルソナ発言1 < 2）はスキップ（false）', () => {
    expect(shouldEvaluateIntervention(1, 2)).toBe(false);
  });

  it('クールダウン超過（3 >= 2）で true', () => {
    expect(shouldEvaluateIntervention(3, 2)).toBe(true);
  });

  it('ファシリテーター発言直後（0ターン）は false', () => {
    expect(shouldEvaluateIntervention(0, 2)).toBe(false);
  });
});

describe('countPersonaTurnsSinceFacilitator', () => {
  it('ファシリテーターターンが存在しない場合は全ペルソナターン数を返す', () => {
    const history = [makeTurn('persona', 't1'), makeTurn('persona', 't2')];
    expect(countPersonaTurnsSinceFacilitator(history)).toBe(2);
  });

  it('末尾がファシリテーターターンの場合は 0 を返す', () => {
    const history = [makeTurn('persona', 't1'), makeTurn('facilitator', 't2')];
    expect(countPersonaTurnsSinceFacilitator(history)).toBe(0);
  });

  it('複数のファシリテーターターンがある場合は最後のもの以降のペルソナターン数を返す', () => {
    const history = [
      makeTurn('persona', 't1'),
      makeTurn('facilitator', 't2'),
      makeTurn('persona', 't3'),
      makeTurn('persona', 't4'),
      makeTurn('facilitator', 't5'),
      makeTurn('persona', 't6'),
    ];
    expect(countPersonaTurnsSinceFacilitator(history)).toBe(1);
  });

  it('空の履歴の場合は 0 を返す', () => {
    expect(countPersonaTurnsSinceFacilitator([])).toBe(0);
  });
});

describe('persistInterventionTurn', () => {
  beforeEach(() => {
    mockUpdate.mockClear();
  });

  it('targetPersonaId がある場合は targeted_by_facilitator の SpeakerSelection を返す', async () => {
    const state = makeState();
    const result = await persistInterventionTurn({ topicId: 'topic1', state, content: '介入メッセージ', targetPersonaId: 'p1', chapterId: 'ch-0' });
    expect(result).toEqual({ personaId: 'p1', reason: 'targeted_by_facilitator' });
  });

  it('targetPersonaId がない場合は undefined を返す', async () => {
    const state = makeState();
    const result = await persistInterventionTurn({ topicId: 'topic1', state, content: '介入メッセージ', targetPersonaId: undefined, chapterId: 'ch-0' });
    expect(result).toBeUndefined();
  });

  it('targetPersonaId の有無にかかわらず state.turns に1件追加される', async () => {
    const state = makeState();
    await persistInterventionTurn({ topicId: 'topic1', state, content: '介入A', targetPersonaId: 'p1', chapterId: 'ch-0' });
    expect(state.turns).toHaveLength(1);
    await persistInterventionTurn({ topicId: 'topic1', state, content: '介入B', targetPersonaId: undefined, chapterId: 'ch-0' });
    expect(state.turns).toHaveLength(2);
  });

  it('追加されたターンの speakerType は facilitator である', async () => {
    const state = makeState();
    await persistInterventionTurn({ topicId: 'topic1', state, content: '介入メッセージ', targetPersonaId: 'p1', chapterId: 'ch-0' });
    expect(state.turns[0].speakerType).toBe('facilitator');
  });

  it('呼び出し後に state.lastSpeakerId が undefined になる', async () => {
    const state = makeState();
    state.lastSpeakerId = 'p1';
    await persistInterventionTurn({ topicId: 'topic1', state, content: '介入', targetPersonaId: 'p2', chapterId: 'ch-0' });
    expect(state.lastSpeakerId).toBeUndefined();
  });

  it('pairConversationTurns は 0 にリセットされる', async () => {
    const state = makeState();
    state.pairConversationTurns = 3;
    await persistInterventionTurn({ topicId: 'topic1', state, content: '介入', targetPersonaId: undefined, chapterId: 'ch-0' });
    expect(state.pairConversationTurns).toBe(0);
  });

  it('state.turns に push されるターンに speakerName/speakerRole が含まれない', async () => {
    const state = makeState();
    await persistInterventionTurn({ topicId: 'topic1', state, content: '介入', targetPersonaId: 'p1', chapterId: 'ch-0' });
    const pushedTurn = state.turns[0] as Record<string, unknown>;
    expect(pushedTurn.speakerName).toBeUndefined();
    expect(pushedTurn.speakerRole).toBeUndefined();
  });
});

// --- tryIntervention 論点伝播テスト ---
vi.mock('../../agents/facilitator-agent.js', () => ({
  evaluateTopicDrift: vi.fn(),
  evaluateStallIntervention: vi.fn(),
}));
vi.mock('./speaker-selection.js', () => ({
  hasHighEngagement: vi.fn(() => false),
}));
vi.mock('./queued-intents.js', () => ({
  addQueuedIntents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./turn.js', () => ({
  addTurn: vi.fn().mockResolvedValue({ id: 'turn-new' }),
}));
vi.mock('./utils.js', () => ({
  pipelineErrorMessage: vi.fn((e: { message: string }) => e.message),
  validPersonaId: vi.fn((_id: string | undefined, _personas: unknown[]) => _id),
}));

import type { Persona, Engagement } from '../../types/debate.types.js';
import type { Chapter } from '../../types/chapter.types.js';

const mockPersonas: Persona[] = [{ id: 'p1', name: 'テスト' } as Persona];
const mockChapter: Chapter = { id: 'ch1', title: '章', focusQuestion: '?', discussionPoints: [] };
const mockEngagements: Engagement[] = [];

describe('tryIntervention - 論点ステータスのマーク', () => {
  let evaluateTopicDrift: ReturnType<typeof vi.fn>;
  let evaluateStallIntervention: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../agents/facilitator-agent.js');
    evaluateTopicDrift = vi.mocked(mod.evaluateTopicDrift);
    evaluateStallIntervention = vi.mocked(mod.evaluateStallIntervention);
  });

  it('介入が selectedDiscussionPointIndex を返した場合、state.discussionPoints を introduced にマークする', async () => {
    evaluateTopicDrift.mockResolvedValueOnce({
      ok: true,
      value: { content: '論点投入', targetPersonaId: 'p1', selectedDiscussionPointIndex: 0 },
    });

    const state = makeState(
      [makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1'), makeTurn('persona', 'p2')],
      [
        { point: '論点A', status: 'untouched' },
        { point: '論点B', status: 'untouched' },
      ]
    );

    const { tryIntervention: tryIntervention_ } = await import('./intervention.js');
    await tryIntervention_({
      topicId: 'topic1',
      personas: mockPersonas,
      chapter: mockChapter,
      state,
      engagements: mockEngagements,
      interventionCooldown: 2,
    });

    expect(state.discussionPoints[0].status).toBe('introduced');
    expect(state.discussionPoints[1].status).toBe('untouched');
  });

  it('selectedDiscussionPointIndex が範囲外の場合はマークしない', async () => {
    evaluateTopicDrift.mockResolvedValueOnce({
      ok: true,
      value: { content: '論点投入', targetPersonaId: 'p1', selectedDiscussionPointIndex: 99 },
    });

    const unaddressedPoints = [{ point: '論点A', status: 'untouched' as const }];
    const state = makeState(
      [makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1'), makeTurn('persona', 'p2')],
      [...unaddressedPoints]
    );

    const { tryIntervention: tryIntervention_ } = await import('./intervention.js');
    await tryIntervention_({
      topicId: 'topic1',
      personas: mockPersonas,
      chapter: mockChapter,
      state,
      engagements: mockEngagements,
      interventionCooldown: 2,
    });

    expect(state.discussionPoints[0].status).toBe('untouched');
  });

  it('selectedDiscussionPointIndex が undefined の場合はマークしない', async () => {
    evaluateTopicDrift.mockResolvedValueOnce({
      ok: true,
      value: { content: '引き戻し', targetPersonaId: 'p1' },
    });

    const state = makeState(
      [makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1'), makeTurn('persona', 'p2')],
      [{ point: '論点A', status: 'untouched' }]
    );

    const { tryIntervention: tryIntervention_ } = await import('./intervention.js');
    await tryIntervention_({
      topicId: 'topic1',
      personas: mockPersonas,
      chapter: mockChapter,
      state,
      engagements: mockEngagements,
      interventionCooldown: 2,
    });

    expect(state.discussionPoints[0].status).toBe('untouched');
  });

  it('未完了論点（addressed 以外）のみを介入関数に渡す', async () => {
    evaluateTopicDrift.mockResolvedValueOnce({
      ok: true,
      value: {},
    });
    evaluateStallIntervention.mockResolvedValueOnce({
      ok: true,
      value: {},
    });

    const state = makeState(
      [makeTurn('facilitator', 'f1'), makeTurn('persona', 'p1'), makeTurn('persona', 'p2')],
      [
        { point: '論点A', status: 'untouched' },
        { point: '論点B', status: 'addressed' },
        { point: '論点C', status: 'introduced' },
      ]
    );

    const { tryIntervention: tryIntervention_ } = await import('./intervention.js');
    await tryIntervention_({
      topicId: 'topic1',
      personas: mockPersonas,
      chapter: mockChapter,
      state,
      engagements: mockEngagements,
      interventionCooldown: 2,
    });

    expect(evaluateTopicDrift).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      ['論点A', '論点C']
    );
  });
});
