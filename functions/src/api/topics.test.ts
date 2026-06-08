import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(),
}));
vi.mock('firebase-admin/data-connect', () => ({
  getDataConnect: vi.fn(),
}));

import { getAuth } from 'firebase-admin/auth';
import { getDataConnect } from 'firebase-admin/data-connect';

const mockDc = { executeQuery: vi.fn(), executeMutation: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuth).mockReturnValue({
    verifyIdToken: vi.fn().mockResolvedValue({ uid: 'admin-1' }),
  } as ReturnType<typeof getAuth>);
  vi.mocked(getDataConnect).mockReturnValue(mockDc as ReturnType<typeof getDataConnect>);
});

import { topicsRouter } from './topics.js';

const app = express();
app.use(express.json());
app.use('/', topicsRouter);

const BEARER = 'Bearer test-token';

describe('POST /api/topics', () => {
  it('creates a topic and returns topicId', async () => {
    mockDc.executeMutation.mockResolvedValue({
      data: { debateTopic_insert: { id: 'topic-1' } },
    });

    const res = await request(app)
      .post('/')
      .set('Authorization', BEARER)
      .send({ title: 'AI規制について' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ topicId: 'topic-1' });
  });

  it('returns 400 when title is empty', async () => {
    const res = await request(app)
      .post('/')
      .set('Authorization', BEARER)
      .send({ title: '' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when title exceeds 500 characters', async () => {
    const res = await request(app)
      .post('/')
      .set('Authorization', BEARER)
      .send({ title: 'a'.repeat(501) });

    expect(res.status).toBe(400);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .post('/')
      .send({ title: 'AI規制について' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/topics', () => {
  it('returns list of topics', async () => {
    const mockTopics = [
      { id: '1', title: 'Topic A', status: 'pending', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
    ];
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopics: mockTopics } });

    const res = await request(app)
      .get('/')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockTopics);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/topics/:id', () => {
  it('returns topic detail', async () => {
    const mockTopic = { id: 'topic-1', title: 'AI規制', status: 'pending', createdAt: '2024-01-01', updatedAt: '2024-01-01' };
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopic: mockTopic } });

    const res = await request(app)
      .get('/topic-1')
      .set('Authorization', BEARER);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('topic-1');
  });

  it('returns 404 when topic not found', async () => {
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopic: null } });

    const res = await request(app)
      .get('/nonexistent')
      .set('Authorization', BEARER);

    expect(res.status).toBe(404);
  });
});
