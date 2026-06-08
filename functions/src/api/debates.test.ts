import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('firebase-admin/auth', () => ({ getAuth: vi.fn() }));
vi.mock('firebase-admin/data-connect', () => ({ getDataConnect: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));
vi.mock('../pipeline/debate-orchestrator.js', () => ({
  DebateOrchestratorService: vi.fn(),
}));

import { getAuth } from 'firebase-admin/auth';
import { getDataConnect } from 'firebase-admin/data-connect';
import { DebateOrchestratorService } from '../pipeline/debate-orchestrator.js';

const mockDc = { executeQuery: vi.fn(), executeMutation: vi.fn() };
const mockRun = vi.fn().mockResolvedValue({ ok: true, value: undefined });
const BEARER = 'Bearer test-token';

const mockTopic = {
  id: 'topic-1', title: 'AI規制', status: 'debating',
  createdAt: '2024-01-01', updatedAt: '2024-01-01',
};
const mockSession = {
  id: 'debate-1', topicId: 'topic-1', status: 'completed', totalTurns: 2,
  createdAt: '2024-01-01', completedAt: '2024-01-02', publishedAt: '2024-01-03',
};
const mockPersonas = [
  {
    id: 'p-1', topicId: 'topic-1', stakeholderRole: '市民', name: '田中',
    age: 40, occupation: '会社員', background: '東京', interests: '安全',
    stanceDirection: 'neutral', approved: true, sortOrder: 0,
  },
  {
    id: 'p-2', topicId: 'topic-1', stakeholderRole: '経営者', name: '佐藤',
    age: 45, occupation: '経営者', background: '起業', interests: '規制',
    stanceDirection: 'against', approved: true, sortOrder: 1,
  },
];
const mockTurns = [
  { id: 't-1', sessionId: 'debate-1', turnIndex: 0, speakerType: 'facilitator', personaId: null, content: 'オープニング', createdAt: '2024-01-01' },
  { id: 't-2', sessionId: 'debate-1', turnIndex: 1, speakerType: 'persona', personaId: 'p-1', content: '私の考えは...', createdAt: '2024-01-01' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuth).mockReturnValue({
    verifyIdToken: vi.fn().mockResolvedValue({ uid: 'admin-1' }),
  } as ReturnType<typeof getAuth>);
  vi.mocked(getDataConnect).mockReturnValue(mockDc as ReturnType<typeof getDataConnect>);
  vi.mocked(DebateOrchestratorService).mockImplementation(() => ({
    run: mockRun,
  } as unknown as InstanceType<typeof DebateOrchestratorService>));
  mockRun.mockResolvedValue({ ok: true, value: undefined });
});

import { topicDebatesRouter, debatesRouter } from './debates.js';

const app = express();
app.use(express.json());
app.use('/', topicDebatesRouter);
app.use('/debates', debatesRouter);

describe('GET /:topicId/debate', () => {
  const mockSession = { id: 'debate-1', topicId: 'topic-1', status: 'completed', totalTurns: 2, createdAt: '2024-01-01', completedAt: '2024-01-02', publishedAt: null };
  const mockTurns = [
    { id: 't-1', sessionId: 'debate-1', turnIndex: 0, speakerType: 'facilitator', personaId: null, content: 'オープニング', createdAt: '2024-01-01' },
    { id: 't-2', sessionId: 'debate-1', turnIndex: 1, speakerType: 'persona', personaId: 'p-1', content: '意見を述べます。', createdAt: '2024-01-01' },
  ];

  it('討論セッションとターン一覧を返す', async () => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateSessions: [mockSession] } })
      .mockResolvedValueOnce({ data: { personaProfiles: mockPersonas } })
      .mockResolvedValueOnce({ data: { debateTurns: mockTurns } });

    const res = await request(app).get('/topic-1/debate').set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('debate-1');
    expect(res.body.turns).toHaveLength(2);
    expect(res.body.turns[0]).toMatchObject({ speakerName: 'ファシリテーター', speakerType: 'facilitator' });
    expect(res.body.turns[1]).toMatchObject({ speakerName: '田中', speakerType: 'persona' });
  });

  it('討論セッションが未作成のとき 404 を返す', async () => {
    mockDc.executeQuery.mockResolvedValueOnce({ data: { debateSessions: [] } });

    const res = await request(app).get('/topic-1/debate').set('Authorization', BEARER);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/topic-1/debate');
    expect(res.status).toBe(401);
  });
});

describe('POST /:topicId/debate/start', () => {
  it('returns 202 with debateSessionId', async () => {
    mockDc.executeQuery.mockResolvedValueOnce({ data: { debateTopic: mockTopic } });
    mockDc.executeMutation.mockResolvedValueOnce({ data: { debateSession_insert: { id: 'debate-1' } } });

    const res = await request(app)
      .post('/topic-1/debate/start')
      .set('Authorization', BEARER);

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('debateSessionId', 'debate-1');
  });

  it('starts DebateOrchestratorService in background', async () => {
    mockDc.executeQuery.mockResolvedValueOnce({ data: { debateTopic: mockTopic } });
    mockDc.executeMutation.mockResolvedValueOnce({ data: { debateSession_insert: { id: 'debate-1' } } });

    await request(app)
      .post('/topic-1/debate/start')
      .set('Authorization', BEARER);

    await new Promise(resolve => setImmediate(resolve));

    expect(mockRun).toHaveBeenCalledWith('debate-1', 'topic-1');
  });

  it('returns 404 when topic not found', async () => {
    mockDc.executeQuery.mockResolvedValueOnce({ data: { debateTopic: null } });

    const res = await request(app)
      .post('/nonexistent/debate/start')
      .set('Authorization', BEARER);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/topic-1/debate/start');
    expect(res.status).toBe(401);
  });
});

describe('POST /debates/:id/publish', () => {
  it('publishes debate session and returns URL', async () => {
    mockDc.executeQuery.mockResolvedValueOnce({ data: { debateSessions: [mockSession] } });
    mockDc.executeMutation.mockResolvedValueOnce({});

    const res = await request(app)
      .post('/debates/debate-1/publish')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', url: '/debate/debate-1' });
    expect(mockDc.executeMutation).toHaveBeenCalledWith('PublishDebateSession', { id: 'debate-1' });
  });

  it('returns 404 when session not found', async () => {
    mockDc.executeQuery.mockResolvedValueOnce({ data: { debateSessions: [] } });

    const res = await request(app)
      .post('/debates/nonexistent/publish')
      .set('Authorization', BEARER);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/debates/debate-1/publish');
    expect(res.status).toBe(401);
  });
});

describe('GET /debates', () => {
  it('returns list of published debates', async () => {
    const mockList = [{ id: 'debate-1', topicTitle: 'AI規制', personaCount: 2, publishedAt: '2024-01-03' }];
    mockDc.executeQuery.mockResolvedValueOnce({ data: { publishedSessions: mockList } });

    const res = await request(app).get('/debates');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockList);
  });
});

describe('GET /debates/:id', () => {
  it('returns PublishedDebateDetail with personas, turns and beliefChangesTriggered', async () => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateSessions: [mockSession] } })
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { personaProfiles: mockPersonas } })
      .mockResolvedValueOnce({ data: { debateTurns: mockTurns } })
      .mockResolvedValueOnce({ data: { postDebateComments: [
        { id: 'c-1', sessionId: 'debate-1', personaId: 'p-1', content: '良い討論でした', sortOrder: 0 },
      ] } })
      .mockResolvedValueOnce({ data: { personaBeliefs: [
        { id: 'b-1', personaId: 'p-1', version: 1, content: '初期信念', changeType: null, changeSummary: null, triggeredByTurnId: null, createdAt: '2024-01-01' },
        { id: 'b-2', personaId: 'p-1', version: 2, content: '変化後信念', changeType: 'partial_acceptance', changeSummary: '一部受容', triggeredByTurnId: 't-2', createdAt: '2024-01-02' },
      ] } })
      .mockResolvedValueOnce({ data: { personaBeliefs: [] } });

    const res = await request(app).get('/debates/debate-1');

    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.id).toBe('debate-1');
    expect(body.topicTitle).toBe('AI規制');

    expect(body.personas).toHaveLength(2);
    expect(body.personas[0].id).toBe('p-1');
    expect(body.personas[0].role).toBe('市民');
    expect(body.personas[0].beliefHistory).toHaveLength(2);
    expect(body.personas[0].beliefHistory[1]).toMatchObject({
      version: 2, changeType: 'partial_acceptance', triggeredByTurnId: 't-2',
    });

    expect(body.turns).toHaveLength(2);
    expect(body.turns[0].speakerType).toBe('facilitator');
    expect(body.turns[0].speakerName).toBe('ファシリテーター');
    expect(body.turns[0].speakerRole).toBe('');
    expect(body.turns[0].beliefChangesTriggered).toEqual([]);
    expect(body.turns[1].speakerName).toBe('田中');
    expect(body.turns[1].beliefChangesTriggered).toHaveLength(1);
    expect(body.turns[1].beliefChangesTriggered[0]).toMatchObject({
      personaId: 'p-1',
      personaName: '田中',
      changeType: 'partial_acceptance',
      changeSummary: '一部受容',
    });

    expect(body.postDebateComments).toHaveLength(1);
    expect(body.postDebateComments[0]).toMatchObject({
      personaId: 'p-1', personaName: '田中', personaRole: '市民', content: '良い討論でした',
    });
  });

  it('returns 404 when session not found', async () => {
    mockDc.executeQuery.mockResolvedValueOnce({ data: { debateSessions: [] } });

    const res = await request(app).get('/debates/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns 404 when session is not published', async () => {
    const unpublished = { ...mockSession, publishedAt: null };
    mockDc.executeQuery.mockResolvedValueOnce({ data: { debateSessions: [unpublished] } });

    const res = await request(app).get('/debates/debate-1');
    expect(res.status).toBe(404);
  });
});
