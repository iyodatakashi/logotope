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

// ---- approvePersonaProfiles ----

describe('approvePersonaProfiles', () => {
  it('batch-updates all personas to approved:true', async () => {
    const snap = makeQuerySnap([{ id: 'p1', data: () => ({}) }, { id: 'p2', data: () => ({}) }]);
    mockCollectionGet.mockResolvedValue(snap);
    await repo.approvePersonaProfiles('topic-1');
    expect(mockBatch.update).toHaveBeenCalledTimes(2);
    expect(mockBatch.commit).toHaveBeenCalled();
  });
});

// ---- createCompletedPersonaInterview ----

describe('createCompletedPersonaInterview', () => {
  it('looks up persona via collectionGroup then sets interview field, returns {id: personaId}', async () => {
    const fakeRef = { update: vi.fn(() => Promise.resolve()) };
    const snap = makeQuerySnap([{ id: 'persona-1', data: () => ({ topicId: 'topic-1' }), ref: fakeRef }]);
    mockCollectionGroupGet.mockResolvedValue(snap);
    const result = await repo.createCompletedPersonaInterview('persona-1', 'interview content');
    expect(fakeRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ interview: expect.objectContaining({ status: 'completed', interviewRecord: 'interview content' }) })
    );
    expect(result.id).toBe('persona-1');
  });
});

// ---- createErrorPersonaInterview ----

describe('createErrorPersonaInterview', () => {
  it('looks up persona via collectionGroup then sets interview.status to error', async () => {
    const fakeRef = { update: vi.fn(() => Promise.resolve()) };
    const snap = makeQuerySnap([{ id: 'persona-1', data: () => ({ topicId: 'topic-1' }), ref: fakeRef }]);
    mockCollectionGroupGet.mockResolvedValue(snap);
    await repo.createErrorPersonaInterview('persona-1', 'something failed');
    expect(fakeRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ interview: expect.objectContaining({ status: 'error', errorMessage: 'something failed' }) })
    );
  });
});

// ---- createPersonaBelief ----

describe('createPersonaBelief', () => {
  it('appends belief via arrayUnion and returns {id}', async () => {
    const fakeRef = { update: vi.fn(() => Promise.resolve()) };
    const snap = makeQuerySnap([{ id: 'persona-1', data: () => ({ topicId: 'topic-1' }), ref: fakeRef }]);
    mockCollectionGroupGet.mockResolvedValue(snap);
    const result = await repo.createPersonaBelief({ personaId: 'persona-1', version: 0, content: '## 立場\n賛成' });
    expect(fakeRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ beliefs: expect.objectContaining({ _type: 'arrayUnion' }) })
    );
    expect(result.id).toBe('mock-id');
  });

  it('includes optional fields when provided', async () => {
    const fakeRef = { update: vi.fn(() => Promise.resolve()) };
    const snap = makeQuerySnap([{ id: 'p1', data: () => ({ topicId: 't1' }), ref: fakeRef }]);
    mockCollectionGroupGet.mockResolvedValue(snap);
    await repo.createPersonaBelief({
      personaId: 'p1', version: 1, content: '変化後',
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

// ---- getApprovedPersonasByTopicId ----

describe('getApprovedPersonasByTopicId', () => {
  it('returns approved personas in sortOrder order', async () => {
    const docs = [
      { id: 'p1', data: () => ({ id: 'p1', topicId: 't1', name: 'A', approved: true, sortOrder: 0, beliefs: [], stakeholderRole: 'r', age: 30, occupation: 'o', background: 'b', interests: 'i', stanceDirection: 's' }) },
      { id: 'p2', data: () => ({ id: 'p2', topicId: 't1', name: 'B', approved: true, sortOrder: 1, beliefs: [], stakeholderRole: 'r2', age: 25, occupation: 'o2', background: 'b2', interests: 'i2', stanceDirection: 's2' }) },
    ];
    const snap = { docs };
    mockOrderByGet.mockResolvedValue(snap);
    const result = await repo.getApprovedPersonasByTopicId('t1');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('p1');
  });
});
