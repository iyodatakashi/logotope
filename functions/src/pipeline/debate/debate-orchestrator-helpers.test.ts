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
  countPersonaTurnsSinceFacilitator,
  persistInterventionTurn,
} from './debate-orchestrator.js';

const makeTurn = (speakerType: 'persona' | 'facilitator', id: string, turnIndex = 0): DebateTurn => ({
  id,
  sessionId: 'topic1',
  turnIndex,
  speakerType,
  content: 'test',
  createdAt: '',
});

const makeState = (turns: DebateTurn[] = []): DebateState => ({
  turns: [...turns],
  lastSpeakerId: undefined,
  silenceMap: new Map(),
  speakCount: new Map(),
  pendingIntents: new Map(),
  pairConversationTurns: 0,
  targetPersona: undefined,
  currentTurnIndex: turns.length,
  lastFacilitatorTurnIndex: -1,
});

describe('countPersonaTurnsSinceFacilitator', () => {
  it('ファシリテーターターンが存在しない場合は全ペルソナターン数を返す', () => {
    const history = [makeTurn('persona', 't1', 0), makeTurn('persona', 't2', 1)];
    expect(countPersonaTurnsSinceFacilitator(history)).toBe(2);
  });

  it('末尾がファシリテーターターンの場合は 0 を返す', () => {
    const history = [makeTurn('persona', 't1', 0), makeTurn('facilitator', 't2', 1)];
    expect(countPersonaTurnsSinceFacilitator(history)).toBe(0);
  });

  it('複数のファシリテーターターンがある場合は最後のもの以降のペルソナターン数を返す', () => {
    const history = [
      makeTurn('persona', 't1', 0),
      makeTurn('facilitator', 't2', 1),
      makeTurn('persona', 't3', 2),
      makeTurn('persona', 't4', 3),
      makeTurn('facilitator', 't5', 4),
      makeTurn('persona', 't6', 5),
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

  it('pairConversationTurns は 0 にリセットされる（非退行確認）', async () => {
    const state = makeState();
    state.pairConversationTurns = 3;
    await persistInterventionTurn({ topicId: 'topic1', state, content: '介入', targetPersonaId: undefined, chapterId: 'ch-0' });
    expect(state.pairConversationTurns).toBe(0);
  });
});
