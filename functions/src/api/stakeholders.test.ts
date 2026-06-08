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

function setupMocks() {
  vi.mocked(getAuth).mockReturnValue({
    verifyIdToken: vi.fn().mockResolvedValue({ uid: 'admin-1' }),
  } as ReturnType<typeof getAuth>);
  vi.mocked(getDataConnect).mockReturnValue(mockDc as ReturnType<typeof getDataConnect>);
  vi.mocked(getFirestore).mockReturnValue({ collection: vi.fn(() => ({ doc: mockDoc })) } as ReturnType<typeof getFirestore>);
  vi.mocked(Anthropic).mockImplementation(() => ({ messages: { create: mockCreate } }) as unknown as Anthropic);
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMocks();
});

import { stakeholdersRouter } from './stakeholders.js';

const app = express();
app.use(express.json());
app.use('/', stakeholdersRouter);

const mockTopic = { id: 'topic-1', title: 'AI規制について', status: 'pending', createdAt: '2024-01-01', updatedAt: '2024-01-01' };

function makeAnthropicResponse(count = 5) {
  const stakeholders = Array.from({ length: count }, (_, i) => ({
    role: `ステークホルダー${i + 1}`, reason: '理由', mainInterests: ['関心'],
    stanceDirection: 'pro', minorityLevel: 'medium',
  }));
  return { content: [{ type: 'tool_use', name: 'submit_stakeholders', input: { stakeholders } }] };
}

describe('GET /:id/stakeholders', () => {
  const mockMap = {
    id: 'sm-1',
    topicId: 'topic-1',
    content: JSON.stringify([
      { role: '経営者', reason: '売上に影響', mainInterests: ['規制緩和'], stanceDirection: 'against', minorityLevel: 'low' },
      { role: '市民団体', reason: '安全性を重視', mainInterests: ['安全', '透明性'], stanceDirection: 'pro', minorityLevel: 'medium' },
    ]),
    approved: true,
    createdAt: '2024-01-01',
  };

  it('ステークホルダー一覧を返す', async () => {
    mockDc.executeQuery.mockResolvedValue({ data: { stakeholderMaps: [mockMap] } });

    const res = await request(app).get('/topic-1/stakeholders').set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 'sm-1-0', role: '経営者', stanceDirection: 'against', minorityLevel: 'low', rationale: '売上に影響' });
    expect(res.body[1]).toMatchObject({ role: '市民団体', stanceDirection: 'pro' });
  });

  it('ステークホルダーマップが未作成のとき 404 を返す', async () => {
    mockDc.executeQuery.mockResolvedValue({ data: { stakeholderMaps: [] } });

    const res = await request(app).get('/topic-1/stakeholders').set('Authorization', BEARER);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/topic-1/stakeholders');
    expect(res.status).toBe(401);
  });
});

describe('POST /:id/stakeholders/generate', () => {
  it('returns 202 with jobId immediately', async () => {
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopic: mockTopic } });
    mockDc.executeMutation.mockResolvedValue({ data: { stakeholderMap_insert: { id: 'sm-1' } } });
    mockCreate.mockResolvedValue(makeAnthropicResponse());

    const res = await request(app)
      .post('/topic-1/stakeholders/generate')
      .set('Authorization', BEARER);

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
  });

  it('returns 404 when topic not found', async () => {
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopic: null } });

    const res = await request(app)
      .post('/nonexistent/stakeholders/generate')
      .set('Authorization', BEARER);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/topic-1/stakeholders/generate');
    expect(res.status).toBe(401);
  });
});

describe('POST /:id/stakeholders/approve', () => {
  const mockMap = { id: 'sm-1', topicId: 'topic-1', content: '[]', approved: false, createdAt: '2024-01-01' };

  it('approved=true: approves map and transitions status to generating_personas', async () => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { stakeholderMaps: [mockMap] } });
    mockDc.executeMutation.mockResolvedValue({});

    const res = await request(app)
      .post('/topic-1/stakeholders/approve')
      .set('Authorization', BEARER)
      .send({ approved: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(mockDc.executeMutation).toHaveBeenCalledWith('ApproveStakeholderMap', { id: 'sm-1' });
    expect(mockDc.executeMutation).toHaveBeenCalledWith('UpdateDebateTopicStatus', expect.objectContaining({ status: 'generating_personas' }));
  });

  it('approved=false: triggers re-generation and returns 202', async () => {
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopic: mockTopic } });
    mockDc.executeMutation.mockResolvedValue({ data: { stakeholderMap_insert: { id: 'sm-2' } } });
    mockCreate.mockResolvedValue(makeAnthropicResponse());

    const res = await request(app)
      .post('/topic-1/stakeholders/approve')
      .set('Authorization', BEARER)
      .send({ approved: false });

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
  });

  it('returns 404 when topic not found', async () => {
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopic: null } });

    const res = await request(app)
      .post('/topic-1/stakeholders/approve')
      .set('Authorization', BEARER)
      .send({ approved: true });

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/topic-1/stakeholders/approve').send({ approved: true });
    expect(res.status).toBe(401);
  });
});
