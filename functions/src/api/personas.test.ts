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

const mockTopic = { id: 'topic-1', title: 'AI規制について', status: 'generating_personas', createdAt: '2024-01-01', updatedAt: '2024-01-01' };
const mockMap = {
  id: 'sm-1', topicId: 'topic-1', approved: true,
  content: JSON.stringify([
    { role: '市民', reason: '理由', mainInterests: ['安全'], stanceDirection: 'neutral', minorityLevel: 'low' },
  ]),
  createdAt: '2024-01-01',
};

function makePersonaResponse() {
  return {
    content: [{
      type: 'tool_use', name: 'submit_personas',
      input: { personas: [{ stakeholderRole: '市民', name: '田中', age: 40, occupation: '会社員', background: '東京', interests: '安全', stanceDirection: 'neutral' }] },
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuth).mockReturnValue({ verifyIdToken: vi.fn().mockResolvedValue({ uid: 'admin-1' }) } as ReturnType<typeof getAuth>);
  vi.mocked(getDataConnect).mockReturnValue(mockDc as ReturnType<typeof getDataConnect>);
  vi.mocked(getFirestore).mockReturnValue({ collection: vi.fn(() => ({ doc: mockDoc })) } as ReturnType<typeof getFirestore>);
  vi.mocked(Anthropic).mockImplementation(() => ({ messages: { create: mockCreate } }) as unknown as Anthropic);
});

import { personasRouter } from './personas.js';

const app = express();
app.use(express.json());
app.use('/', personasRouter);

describe('GET /:id/personas', () => {
  const mockPersonaList = [
    { id: 'p-1', topicId: 'topic-1', stakeholderRole: '市民', name: '田中', age: 40, occupation: '会社員', background: '東京', interests: '安全', stanceDirection: 'neutral', approved: false, sortOrder: 0 },
    { id: 'p-2', topicId: 'topic-1', stakeholderRole: '経営者', name: '佐藤', age: 45, occupation: '経営者', background: '起業', interests: '規制', stanceDirection: 'against', approved: false, sortOrder: 1 },
  ];

  it('ペルソナ一覧を返す', async () => {
    mockDc.executeQuery.mockResolvedValue({ data: { personaProfiles: mockPersonaList } });

    const res = await request(app).get('/topic-1/personas').set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 'p-1', name: '田中', stakeholderRole: '市民' });
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/topic-1/personas');
    expect(res.status).toBe(401);
  });
});

describe('POST /:id/personas/generate', () => {
  it('returns 202 with jobId immediately', async () => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { stakeholderMaps: [mockMap] } });
    mockDc.executeMutation.mockResolvedValue({ data: { personaProfile_insert: { id: 'p-1' } } });
    mockCreate.mockResolvedValue(makePersonaResponse());

    const res = await request(app)
      .post('/topic-1/personas/generate')
      .set('Authorization', BEARER);

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
  });

  it('returns 404 when topic not found', async () => {
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopic: null } });

    const res = await request(app)
      .post('/nonexistent/personas/generate')
      .set('Authorization', BEARER);

    expect(res.status).toBe(404);
  });

  it('returns 409 when stakeholder map is not approved yet', async () => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { stakeholderMaps: [{ ...mockMap, approved: false }] } });

    const res = await request(app)
      .post('/topic-1/personas/generate')
      .set('Authorization', BEARER);

    expect(res.status).toBe(409);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/topic-1/personas/generate');
    expect(res.status).toBe(401);
  });
});

describe('POST /:id/personas/approve', () => {
  it('approved=true: approves personas and transitions to interviewing', async () => {
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopic: mockTopic } });
    mockDc.executeMutation.mockResolvedValue({});

    const res = await request(app)
      .post('/topic-1/personas/approve')
      .set('Authorization', BEARER)
      .send({ approved: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(mockDc.executeMutation).toHaveBeenCalledWith('ApprovePersonaProfiles', { topicId: 'topic-1' });
    expect(mockDc.executeMutation).toHaveBeenCalledWith('UpdateDebateTopicStatus', expect.objectContaining({ status: 'interviewing' }));
  });

  it('approved=false: triggers re-generation and returns 202', async () => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { stakeholderMaps: [mockMap] } });
    mockDc.executeMutation.mockResolvedValue({ data: { personaProfile_insert: { id: 'p-1' } } });
    mockCreate.mockResolvedValue(makePersonaResponse());

    const res = await request(app)
      .post('/topic-1/personas/approve')
      .set('Authorization', BEARER)
      .send({ approved: false });

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/topic-1/personas/approve').send({ approved: true });
    expect(res.status).toBe(401);
  });
});
