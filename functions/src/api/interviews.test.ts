import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('firebase-admin/auth', () => ({ getAuth: vi.fn() }));
vi.mock('firebase-admin/data-connect', () => ({ getDataConnect: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));

import { getAuth } from 'firebase-admin/auth';
import { getDataConnect } from 'firebase-admin/data-connect';
import { getFirestore } from 'firebase-admin/firestore';
import Anthropic from '@anthropic-ai/sdk';

const mockDc = { executeQuery: vi.fn(), executeMutation: vi.fn() };
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ set: mockSet }));
const mockCreate = vi.fn();
const BEARER = 'Bearer test-token';

const mockTopic = { id: 'topic-1', title: 'AI規制', status: 'interviewing', createdAt: '2024-01-01', updatedAt: '2024-01-01' };
const mockPersonas = [
  { id: 'p-1', topicId: 'topic-1', stakeholderRole: '市民', name: '田中', age: 40, occupation: '会社員', background: '東京', interests: '安全', stanceDirection: 'neutral', approved: true, sortOrder: 0 },
  { id: 'p-2', topicId: 'topic-1', stakeholderRole: '経営者', name: '佐藤', age: 45, occupation: '経営者', background: '起業', interests: '規制', stanceDirection: 'against', approved: true, sortOrder: 1 },
];

function makeInterviewResponse(name: string) {
  return {
    content: [{
      type: 'tool_use', name: 'submit_interview',
      input: { interviewRecord: `${name}への取材`, initialBelief: '## 立場\n...' },
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuth).mockReturnValue({ verifyIdToken: vi.fn().mockResolvedValue({ uid: 'admin-1' }) } as ReturnType<typeof getAuth>);
  vi.mocked(getDataConnect).mockReturnValue(mockDc as ReturnType<typeof getDataConnect>);
  vi.mocked(getFirestore).mockReturnValue({ collection: vi.fn(() => ({ doc: mockDoc })) } as ReturnType<typeof getFirestore>);
  vi.mocked(Anthropic).mockImplementation(() => ({ messages: { create: mockCreate } }) as unknown as Anthropic);
  mockDc.executeMutation.mockResolvedValue({ data: { personaInterview_insert: { id: 'i-1' }, personaBelief_insert: { id: 'b-1' } } });
});

import { interviewsRouter } from './interviews.js';

const app = express();
app.use(express.json());
app.use('/', interviewsRouter);

describe('GET /:id/interviews', () => {
  const mockInterview = { id: 'i-1', personaId: 'p-1', interviewRecord: '取材内容', status: 'completed', errorMessage: null, completedAt: '2024-01-01' };

  it('取材結果一覧を返す', async () => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { personaProfiles: mockPersonas } })
      .mockResolvedValueOnce({ data: { personaInterviews: [mockInterview] } })
      .mockResolvedValueOnce({ data: { personaInterviews: [] } });

    const res = await request(app).get('/topic-1/interviews').set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ personaId: 'p-1', personaName: '田中', interviewRecord: '取材内容', status: 'completed' });
    expect(res.body[1]).toMatchObject({ personaId: 'p-2', personaName: '佐藤', status: 'pending' });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/topic-1/interviews');
    expect(res.status).toBe(401);
  });
});

describe('POST /:id/interviews/start', () => {
  it('returns 202 with jobId immediately', async () => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { personaProfiles: mockPersonas } });
    mockCreate.mockResolvedValue(makeInterviewResponse('田中'));

    const res = await request(app)
      .post('/topic-1/interviews/start')
      .set('Authorization', BEARER);

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
  });

  it('returns 404 when topic not found', async () => {
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopic: null } });

    const res = await request(app)
      .post('/nonexistent/interviews/start')
      .set('Authorization', BEARER);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/topic-1/interviews/start');
    expect(res.status).toBe(401);
  });
});

describe('POST /:id/interviews/:personaId/retry', () => {
  it('returns 202 with jobId for persona retry', async () => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { personaProfiles: [mockPersonas[0]] } });
    mockCreate.mockResolvedValue(makeInterviewResponse('田中'));

    const res = await request(app)
      .post('/topic-1/interviews/p-1/retry')
      .set('Authorization', BEARER);

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
  });

  it('returns 404 when persona not found', async () => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { personaProfiles: [] } });

    const res = await request(app)
      .post('/topic-1/interviews/nonexistent/retry')
      .set('Authorization', BEARER);

    expect(res.status).toBe(404);
  });
});

describe('POST /:id/interviews/approve', () => {
  it('approves interviews and transitions to debating', async () => {
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopic: mockTopic } });
    mockDc.executeMutation.mockResolvedValue({});

    const res = await request(app)
      .post('/topic-1/interviews/approve')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(mockDc.executeMutation).toHaveBeenCalledWith('UpdateDebateTopicStatus', expect.objectContaining({ status: 'debating' }));
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/topic-1/interviews/approve');
    expect(res.status).toBe(401);
  });
});
