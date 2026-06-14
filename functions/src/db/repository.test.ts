import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  Timestamp: {
    now: vi.fn(() => ({ toDate: () => new Date('2024-01-01T00:00:00Z'), toISOString: () => '2024-01-01T00:00:00.000Z' })),
  },
  FieldValue: {
    arrayUnion: vi.fn((...items: unknown[]) => ({ _type: 'arrayUnion', items })),
    delete: vi.fn(() => ({ _type: 'delete' })),
  },
}));

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'mock-id') }));

import * as repo from './repository.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// --- Mock infrastructure ---

const mockDocRef = {
  get: vi.fn(),
  set: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  ref: {} as object,
};

const mockBatch = {
  update: vi.fn(),
  delete: vi.fn(),
  set: vi.fn(),
  commit: vi.fn(() => Promise.resolve()),
};

const makeQuerySnap = (docs: { id: string; data: () => unknown; ref?: object }[]) => ({
  empty: docs.length === 0,
  docs: docs.map(d => ({ ...d, ref: d.ref ?? { id: d.id, update: vi.fn(() => Promise.resolve()), set: vi.fn(() => Promise.resolve()) } })),
});

const mockCollectionGroupGet = vi.fn();
const mockCollectionGet = vi.fn();
const mockOrderByGet = vi.fn();
const mockWhereForOrderBy = vi.fn(() => ({ get: mockOrderByGet }));

const mockTx = {
  get: vi.fn(),
  update: vi.fn(),
};

const mockDb = {
  doc: vi.fn(() => mockDocRef),
  collection: vi.fn(() => ({
    get: mockCollectionGet,
    where: vi.fn(() => ({ orderBy: mockWhereForOrderBy, get: vi.fn(() => Promise.resolve(makeQuerySnap([]))) })),
  })),
  collectionGroup: vi.fn(() => ({
    where: vi.fn(() => ({
      limit: vi.fn(() => ({ get: mockCollectionGroupGet })),
    })),
  })),
  batch: vi.fn(() => mockBatch),
  runTransaction: vi.fn((fn: (tx: typeof mockTx) => unknown) => Promise.resolve(fn(mockTx))),
};

beforeEach(() => {
  vi.mocked(getFirestore).mockReturnValue(mockDb as ReturnType<typeof getFirestore>);
  vi.clearAllMocks();
  vi.mocked(getFirestore).mockReturnValue(mockDb as ReturnType<typeof getFirestore>);
  mockDocRef.get.mockResolvedValue({ exists: false, id: 'doc-id', data: () => undefined });
});

// ---- updateTopicPhase (task 2.1) ----

describe('updateTopicPhase', () => {
  it('updates phase, phaseStatus and updatedAt on topics/{id}', async () => {
    await repo.updateTopicPhase('topic-1', 5, 'running');
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1');
    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 5, phaseStatus: 'running' })
    );
    const call = mockDocRef.update.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call).toHaveProperty('updatedAt');
  });
});

// ---- discardChapterProgress (task 2.3) ----

describe('discardChapterProgress', () => {
  it('現在章以降の途中ターンを破棄し、派生信念とエンゲージメントを巻き戻す', async () => {
    const sessionData = {
      turns: [
        { id: 'turn-0', turnIndex: 0, chapterIndex: 0, content: 'a' },
        { id: 'turn-1', turnIndex: 1, chapterIndex: 1, content: 'b' },
        { id: 'turn-2', turnIndex: 2, chapterIndex: 1, content: 'c' },
      ],
    };
    mockDocRef.get.mockResolvedValueOnce({ exists: true, data: () => sessionData });

    const personaRef = { update: vi.fn(() => Promise.resolve()) };
    const personasSnap = makeQuerySnap([
      {
        id: 'p1',
        data: () => ({
          beliefs: [
            { id: 'b0', version: 0, triggeredByTurnId: null },
            { id: 'b1', version: 1, triggeredByTurnId: 'turn-1' },
          ],
        }),
        ref: personaRef,
      },
    ]);
    const engRef = { update: vi.fn(() => Promise.resolve()) };
    const engSnap = makeQuerySnap([
      { id: 'p1', data: () => ({ history: { '0': {}, '1': {}, '2': {} } }), ref: engRef },
    ]);
    mockCollectionGet.mockResolvedValueOnce(personasSnap).mockResolvedValueOnce(engSnap);

    await repo.discardChapterProgress('topic-1', 1);

    // 完了済み章(turn-0)のみ残す（進行状態はトピックが保持）
    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        currentChapterIndex: 1,
        turns: [expect.objectContaining({ id: 'turn-0' })],
      })
    );
    // 削除ターン由来の信念バージョン(b1)を除去
    expect(personaRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ beliefs: [expect.objectContaining({ id: 'b0' })] })
    );
    // 削除ターンのエンゲージメント履歴を削除
    expect(engRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ 'history.1': expect.anything(), 'history.2': expect.anything() })
    );
  });
});

// ---- createStakeholderMap ----

describe('createStakeholderMap', () => {
  it('parses JSON content, sets stakeholders on topic, returns {id: topicId}', async () => {
    const content = JSON.stringify({ items: [{ role: 'A' }], approved: false });
    const result = await repo.createStakeholderMap('topic-1', content);
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1');
    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ stakeholders: expect.objectContaining({ approved: false }) })
    );
    expect(result.id).toBe('topic-1');
  });
});

// ---- createPersonaProfile ----

describe('createPersonaProfile', () => {
  it('creates persona doc with nanoid ID, stores id field, returns {id}', async () => {
    const params = {
      topicId: 'topic-1', stakeholderRole: 'market', name: '田中', age: 30,
      occupation: 'eng', background: 'bg', interests: 'tech', sortOrder: 0,
    };
    const result = await repo.createPersonaProfile(params);
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/personas/mock-id');
    expect(mockDocRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mock-id', topicId: 'topic-1', name: '田中', beliefs: [] })
    );
    expect(result.id).toBe('mock-id');
  });
});

// ---- createCompletedPersonaInterview ----

describe('createCompletedPersonaInterview', () => {
  it('updates persona doc with interview field, returns {id: personaId}', async () => {
    const result = await repo.createCompletedPersonaInterview('topic-1', 'persona-1', 'interview content');
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/personas/persona-1');
    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ interview: expect.objectContaining({ status: 'completed', interviewRecord: 'interview content' }) })
    );
    expect(result.id).toBe('persona-1');
  });
});

// ---- createErrorPersonaInterview ----

describe('createErrorPersonaInterview', () => {
  it('updates persona doc with error interview status', async () => {
    await repo.createErrorPersonaInterview('topic-1', 'persona-1', 'something failed');
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/personas/persona-1');
    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ interview: expect.objectContaining({ status: 'error', errorMessage: 'something failed' }) })
    );
  });
});

// ---- createPersonaBelief ----

describe('createPersonaBelief', () => {
  it('appends belief via arrayUnion on persona doc, returns {id}', async () => {
    const result = await repo.createPersonaBelief({ topicId: 'topic-1', personaId: 'persona-1', version: 0, content: '## 立場\n賛成' });
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/personas/persona-1');
    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ beliefs: expect.objectContaining({ _type: 'arrayUnion' }) })
    );
    expect(result.id).toBe('mock-id');
  });

  it('includes optional fields when provided', async () => {
    await repo.createPersonaBelief({
      topicId: 'topic-1', personaId: 'p1', version: 1, content: '変化後',
      changeType: 'partial_acceptance', triggeredByTurnId: 'turn-5',
    });
    expect(FieldValue.arrayUnion).toHaveBeenCalledWith(
      expect.objectContaining({ changeType: 'partial_acceptance', triggeredByTurnId: 'turn-5' })
    );
  });
});

// ---- createDebateSession ----

describe('createDebateSession', () => {
  it('creates sessions/0 when not exists, returns {id: topicId}', async () => {
    mockDocRef.get.mockResolvedValue({ exists: false, id: 'session-0', data: () => undefined });
    const result = await repo.createDebateSession('topic-1');
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/sessions/0');
    expect(mockDocRef.set).toHaveBeenCalledWith(
      expect.objectContaining({ turns: [], postDebateComments: [] })
    );
    expect(result.id).toBe('topic-1');
  });

  it('skips creation when sessions/0 already exists (idempotent)', async () => {
    mockDocRef.get.mockResolvedValue({ exists: true, id: 'session-0', data: () => ({}) });
    const result = await repo.createDebateSession('topic-1');
    expect(mockDocRef.set).not.toHaveBeenCalled();
    expect(result.id).toBe('topic-1');
  });
});

// ---- completeDebateSession ----

describe('completeDebateSession', () => {
  it('updates sessions/0 with totalTurns and completedAt (no status)', async () => {
    await repo.completeDebateSession('topic-1', 42);
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/sessions/0');
    const call = mockDocRef.update.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({ totalTurns: 42 });
    expect(call).toHaveProperty('completedAt');
    expect(call).not.toHaveProperty('status');
  });
});

// ---- createDebateTurn ----

describe('createDebateTurn', () => {
  it('appends turn via arrayUnion and returns {id}', async () => {
    const result = await repo.createDebateTurn({
      sessionId: 'topic-1', turnIndex: 0, speakerType: 'facilitator', content: '討論開始',
    });
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/sessions/0');
    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ turns: expect.objectContaining({ _type: 'arrayUnion' }) })
    );
    expect(result.id).toBe('mock-id');
  });

  it('includes personaId for persona speaker', async () => {
    await repo.createDebateTurn({
      sessionId: 'topic-1', turnIndex: 1, speakerType: 'persona', personaId: 'p1', content: '反対します',
    });
    expect(FieldValue.arrayUnion).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 'p1', speakerType: 'persona' })
    );
  });

  it('includes chapterIndex in turn when provided', async () => {
    await repo.createDebateTurn({
      sessionId: 'topic-1', turnIndex: 2, speakerType: 'persona', personaId: 'p1', content: '発言', chapterIndex: 1,
    });
    expect(FieldValue.arrayUnion).toHaveBeenCalledWith(
      expect.objectContaining({ chapterIndex: 1 })
    );
  });

  it('omits chapterIndex from turn when not provided', async () => {
    await repo.createDebateTurn({
      sessionId: 'topic-1', turnIndex: 3, speakerType: 'facilitator', content: '介入',
    });
    const call = vi.mocked(FieldValue.arrayUnion).mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty('chapterIndex');
  });

  it('includes addressedPersonaId in turn when provided（指名・直接質問の永続化）', async () => {
    await repo.createDebateTurn({
      sessionId: 'topic-1', turnIndex: 4, speakerType: 'facilitator', content: '鈴木さんはいかがですか？', chapterIndex: 0, addressedPersonaId: 'p2',
    });
    expect(FieldValue.arrayUnion).toHaveBeenCalledWith(
      expect.objectContaining({ addressedPersonaId: 'p2' })
    );
  });

  it('omits addressedPersonaId from turn when not provided', async () => {
    await repo.createDebateTurn({
      sessionId: 'topic-1', turnIndex: 5, speakerType: 'facilitator', content: 'まとめです。',
    });
    const call = vi.mocked(FieldValue.arrayUnion).mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty('addressedPersonaId');
  });
});

// ---- saveChapters ----

describe('saveChapters', () => {
  it('updates sessions/0 with chapters array and currentChapterIndex: 0', async () => {
    const chapters = [
      { index: 0, title: '導入', focusQuestion: 'この問題の核心は何か？' },
      { index: 1, title: '核心的対立', focusQuestion: '最も意見が分かれる点はどこか？' },
    ];
    await repo.saveChapters('topic-1', chapters);
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/sessions/0');
    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ chapters, currentChapterIndex: 0 })
    );
  });
});

// ---- updateCurrentChapterIndex ----

describe('updateCurrentChapterIndex', () => {
  it('updates sessions/0.currentChapterIndex to the given value', async () => {
    await repo.updateCurrentChapterIndex('topic-1', 2);
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/sessions/0');
    expect(mockDocRef.update).toHaveBeenCalledWith({ currentChapterIndex: 2 });
  });
});

// ---- createPostDebateComment ----

describe('createPostDebateComment', () => {
  it('appends comment via arrayUnion and returns {id}', async () => {
    const result = await repo.createPostDebateComment({
      sessionId: 'topic-1', personaId: 'p1', content: 'コメント', sortOrder: 0,
    });
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/sessions/0');
    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ postDebateComments: expect.objectContaining({ _type: 'arrayUnion' }) })
    );
    expect(result.id).toBe('mock-id');
  });
});

// ---- saveEngagements ----

describe('saveEngagements', () => {
  it('Map 形式で history エントリを set/mergeFields する', async () => {
    await repo.saveEngagements({
      sessionId: 'topic-1',
      turnIndex: 5,
      assessments: [
        { personaId: 'p1', score: 3, mode: 'reaction', intentSummary: '短く同意' },
      ],
    });
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/sessions/0/engagements/p1');
    expect(mockDocRef.set).toHaveBeenCalledWith(
      { history: { '5': { score: 3, mode: 'reaction', intentSummary: '短く同意' } } },
      { mergeFields: ['history.5'] }
    );
  });

  it('各ペルソナに対して history の set を1回ずつ呼ぶ', async () => {
    await repo.saveEngagements({
      sessionId: 'topic-1',
      turnIndex: 3,
      assessments: [
        { personaId: 'p1', score: 2, mode: 'reaction' },
        { personaId: 'p2', score: 5, mode: 'opinion', intentSummary: '言いたい' },
      ],
    });
    expect(mockDocRef.set).toHaveBeenCalledTimes(2);
  });

  it('pendingIntents には書き込まない（キュー書き込みは setPendingIntents に分離）', async () => {
    await repo.saveEngagements({
      sessionId: 'topic-1',
      turnIndex: 5,
      assessments: [
        { personaId: 'p1', score: 5, mode: 'opinion', intentSummary: '反論したい' },
      ],
    });
    for (const call of mockDocRef.set.mock.calls) {
      expect(Object.keys(call[0] as Record<string, unknown>)).not.toContain('pendingIntents');
    }
  });
});

// ---- setPendingIntents / トピック状態の権威書き込み ----

describe('setPendingIntents - task 3.2: キュー write-through', () => {
  it('ペルソナ単位で pendingIntents 配列を全置換で書き込む', async () => {
    await repo.setPendingIntents('topic-1', 'p1', [
      { triggerTurnIndex: 2, intentSummary: '意図A' },
      { triggerTurnIndex: 5, intentSummary: '意図B' },
    ]);
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/sessions/0/engagements/p1');
    expect(mockDocRef.set).toHaveBeenCalledWith(
      {
        pendingIntents: [
          { triggerTurnIndex: 2, intentSummary: '意図A' },
          { triggerTurnIndex: 5, intentSummary: '意図B' },
        ],
      },
      { merge: true }
    );
  });

  it('空配列を書き込んでキューを空にできる', async () => {
    await repo.setPendingIntents('topic-1', 'p1', []);
    expect(mockDocRef.set).toHaveBeenCalledWith({ pendingIntents: [] }, { merge: true });
  });

  it('consumePendingIntent は存在しない（setPendingIntents に置換済み）', () => {
    expect('consumePendingIntent' in repo).toBe(false);
  });
});

describe('markTopicStopped - 停止終端', () => {
  it('トピックの phaseStatus を stopped にする', async () => {
    await repo.markTopicStopped('topic-1');
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1');
    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ phaseStatus: 'stopped' })
    );
  });
});

describe('isDebateActive - 停止ゲート', () => {
  it('phase=5 かつ phaseStatus=running のとき true', async () => {
    mockDocRef.get.mockResolvedValue({ exists: true, data: () => ({ phase: 5, phaseStatus: 'running' }) });
    expect(await repo.isDebateActive('topic-1')).toBe(true);
  });

  it('phaseStatus が stopped のとき false', async () => {
    mockDocRef.get.mockResolvedValue({ exists: true, data: () => ({ phase: 5, phaseStatus: 'stopped' }) });
    expect(await repo.isDebateActive('topic-1')).toBe(false);
  });

  it('phase が 5 でない（上流再生成）とき false', async () => {
    mockDocRef.get.mockResolvedValue({ exists: true, data: () => ({ phase: 2, phaseStatus: 'running' }) });
    expect(await repo.isDebateActive('topic-1')).toBe(false);
  });
});

describe('finalizeTopicIfRunning - 実行中のときのみ生成完了', () => {
  it('running なら generated を書き true を返す', async () => {
    mockTx.get.mockResolvedValue({ exists: true, data: () => ({ phaseStatus: 'running' }) });
    const result = await repo.finalizeTopicIfRunning('topic-1');
    expect(result).toBe(true);
    expect(mockTx.update).toHaveBeenCalledWith(
      mockDocRef,
      expect.objectContaining({ phaseStatus: 'generated' })
    );
  });

  it('stopped なら無変更で false を返す（停止を上書きしない）', async () => {
    mockTx.get.mockResolvedValue({ exists: true, data: () => ({ phaseStatus: 'stopped' }) });
    const result = await repo.finalizeTopicIfRunning('topic-1');
    expect(result).toBe(false);
    expect(mockTx.update).not.toHaveBeenCalled();
  });
});

// ---- loadPendingIntents ----

describe('loadPendingIntents', () => {
  it('returns Map of personaId to pendingIntents for all engagement docs', async () => {
    const docs = [
      { id: 'p1', data: () => ({ pendingIntents: [{ triggerTurnIndex: 3, intentSummary: '言いたい' }] }) },
      { id: 'p2', data: () => ({ pendingIntents: [] }) },
    ];
    mockCollectionGet.mockResolvedValue({ docs });
    const result = await repo.loadPendingIntents('topic-1');
    expect(mockDb.collection).toHaveBeenCalledWith('topics/topic-1/sessions/0/engagements');
    expect(result.get('p1')).toHaveLength(1);
    expect(result.get('p1')![0].intentSummary).toBe('言いたい');
    expect(result.get('p2')).toHaveLength(0);
  });

  it('returns empty Map when no engagement docs exist', async () => {
    mockCollectionGet.mockResolvedValue({ docs: [] });
    const result = await repo.loadPendingIntents('topic-1');
    expect(result.size).toBe(0);
  });
});

// ---- createDebateTurn — Task 3.3 engagements 削除 ----

describe('createDebateTurn — engagements フィールドは保存しない', () => {
  it('turn エントリに engagements フィールドが含まれない', async () => {
    await repo.createDebateTurn({
      sessionId: 'topic-1', turnIndex: 3, speakerType: 'persona', personaId: 'p1', content: '発言',
    });
    const call = vi.mocked(FieldValue.arrayUnion).mock.calls[0][0] as Record<string, unknown>;
    expect(call).not.toHaveProperty('engagements');
  });
});

// ---- getTopicById ----

describe('getTopicById', () => {
  it('returns topic data when document exists', async () => {
    const now = { toDate: () => new Date('2024-01-01T00:00:00Z') };
    mockDocRef.get.mockResolvedValue({
      exists: true, id: 'topic-1',
      data: () => ({ title: 'AI規制', status: 'pending', createdAt: now, updatedAt: now }),
    });
    const result = await repo.getTopicById('topic-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('topic-1');
    expect(result!.title).toBe('AI規制');
  });

  it('returns null when document does not exist', async () => {
    mockDocRef.get.mockResolvedValue({ exists: false, id: 'x', data: () => undefined });
    const result = await repo.getTopicById('nonexistent');
    expect(result).toBeNull();
  });
});

