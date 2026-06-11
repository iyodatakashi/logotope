import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  Timestamp: {
    now: vi.fn(() => ({ toDate: () => new Date('2024-01-01T00:00:00Z'), toISOString: () => '2024-01-01T00:00:00.000Z' })),
  },
  FieldValue: {
    arrayUnion: vi.fn((...items: unknown[]) => ({ _type: 'arrayUnion', items })),
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
};

beforeEach(() => {
  vi.mocked(getFirestore).mockReturnValue(mockDb as ReturnType<typeof getFirestore>);
  vi.clearAllMocks();
  vi.mocked(getFirestore).mockReturnValue(mockDb as ReturnType<typeof getFirestore>);
  mockDocRef.get.mockResolvedValue({ exists: false, id: 'doc-id', data: () => undefined });
});

// ---- updateTopicStatus ----

describe('updateTopicStatus', () => {
  it('updates status and updatedAt on topics/{id}', async () => {
    await repo.updateTopicStatus('topic-1', 'debating');
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1');
    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'debating' })
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
      occupation: 'eng', background: 'bg', interests: 'tech', stanceDirection: 'pro', sortOrder: 0,
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
      expect.objectContaining({ status: 'debating', turns: [], postDebateComments: [] })
    );
    expect(result.id).toBe('topic-1');
  });

  it('skips creation when sessions/0 already exists (idempotent)', async () => {
    mockDocRef.get.mockResolvedValue({ exists: true, id: 'session-0', data: () => ({ status: 'debating' }) });
    const result = await repo.createDebateSession('topic-1');
    expect(mockDocRef.set).not.toHaveBeenCalled();
    expect(result.id).toBe('topic-1');
  });
});

// ---- completeDebateSession ----

describe('completeDebateSession', () => {
  it('updates sessions/0 with completed status and totalTurns', async () => {
    await repo.completeDebateSession('topic-1', 42);
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/sessions/0');
    expect(mockDocRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', totalTurns: 42 })
    );
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
        { personaId: 'p1', score: 3, mode: 'reaction', intentSummary: '短く同意', addToPending: false },
      ],
    });
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/sessions/0/engagements/p1');
    expect(mockDocRef.set).toHaveBeenCalledWith(
      { history: { '5': { score: 3, mode: 'reaction', intentSummary: '短く同意' } } },
      { mergeFields: ['history.5'] }
    );
  });

  it('addToPending が true のとき pendingIntents に arrayUnion で追加する', async () => {
    await repo.saveEngagements({
      sessionId: 'topic-1',
      turnIndex: 5,
      assessments: [
        { personaId: 'p1', score: 4, mode: 'full', intentSummary: '反論したい', addToPending: true },
      ],
    });
    expect(mockDocRef.set).toHaveBeenCalledTimes(2);
    const historyCall = mockDocRef.set.mock.calls[0];
    expect(historyCall[0]).toEqual({ history: { '5': { score: 4, mode: 'full', intentSummary: '反論したい' } } });
    expect(historyCall[1]).toEqual({ mergeFields: ['history.5'] });
    const pendingCall = mockDocRef.set.mock.calls[1];
    expect(pendingCall[0]).toEqual(
      expect.objectContaining({ pendingIntents: expect.objectContaining({ _type: 'arrayUnion' }) })
    );
    expect(pendingCall[1]).toEqual({ merge: true });
  });

  it('addToPending が false のとき pendingIntents の set を呼ばない', async () => {
    await repo.saveEngagements({
      sessionId: 'topic-1',
      turnIndex: 5,
      assessments: [
        { personaId: 'p1', score: 3, mode: 'reaction', intentSummary: 'そうですね', addToPending: false },
      ],
    });
    expect(mockDocRef.set).toHaveBeenCalledTimes(1);
    expect(mockDocRef.set.mock.calls[0][1]).toEqual({ mergeFields: ['history.5'] });
  });

  it('各ペルソナに対して set を呼ぶ（addToPending なし: 2回、あり: 3回）', async () => {
    await repo.saveEngagements({
      sessionId: 'topic-1',
      turnIndex: 3,
      assessments: [
        { personaId: 'p1', score: 2, mode: 'reaction', addToPending: false },
        { personaId: 'p2', score: 5, mode: 'full', intentSummary: '言いたい', addToPending: true },
      ],
    });
    // p1: history 1 call, p2: history + pendingIntents = 2 calls → total 3
    expect(mockDocRef.set).toHaveBeenCalledTimes(3);
  });
});

// ---- consumePendingIntent ----

describe('consumePendingIntent', () => {
  it('removes the first (oldest) entry from pendingIntents', async () => {
    mockDocRef.get.mockResolvedValue({
      exists: true,
      id: 'p1',
      data: () => ({
        history: [],
        pendingIntents: [
          { triggerTurnIndex: 2, intentSummary: '古い意図' },
          { triggerTurnIndex: 5, intentSummary: '新しい意図' },
        ],
      }),
    });
    await repo.consumePendingIntent('topic-1', 'p1');
    expect(mockDb.doc).toHaveBeenCalledWith('topics/topic-1/sessions/0/engagements/p1');
    expect(mockDocRef.update).toHaveBeenCalledWith({
      pendingIntents: [{ triggerTurnIndex: 5, intentSummary: '新しい意図' }],
    });
  });

  it('sets pendingIntents to empty array when only one entry exists', async () => {
    mockDocRef.get.mockResolvedValue({
      exists: true,
      id: 'p1',
      data: () => ({
        pendingIntents: [{ triggerTurnIndex: 2, intentSummary: '唯一の意図' }],
      }),
    });
    await repo.consumePendingIntent('topic-1', 'p1');
    expect(mockDocRef.update).toHaveBeenCalledWith({ pendingIntents: [] });
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

