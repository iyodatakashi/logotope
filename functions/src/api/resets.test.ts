import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-functions/v2/https', () => {
  class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    onCall: (optionsOrHandler: unknown, handler?: unknown) =>
      typeof optionsOrHandler === 'function' ? optionsOrHandler : handler,
    HttpsError,
  };
});
vi.mock('firebase-admin/data-connect', () => ({ getDataConnect: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));
vi.mock('../pipeline/progress-tracker.js', () => ({
  ProgressTrackerService: vi.fn(),
}));

import { getDataConnect } from 'firebase-admin/data-connect';
import { getFirestore } from 'firebase-admin/firestore';
import { ProgressTrackerService } from '../pipeline/progress-tracker.js';
import { resetToPhase1, resetToPhase2, resetToPhase3 } from './resets.js';

const mockDc = { executeQuery: vi.fn(), executeMutation: vi.fn() };
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ set: mockSet }));
const mockUpdateStatus = vi.fn().mockResolvedValue(undefined);

const mockTopic = { id: 'topic-1', title: 'AI規制について', status: 'generating_personas', createdAt: '2024-01-01', updatedAt: '2024-01-01' };
const mockSession = { id: 'session-1', topicId: 'topic-1', status: 'completed', createdAt: '2024-01-01' };

type Handler = (request: { auth: { uid: string }; data: unknown }) => Promise<unknown>;
const authedRequest = (topicId: string) => ({ auth: { uid: 'user-1' }, data: { topicId } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDataConnect).mockReturnValue(mockDc as ReturnType<typeof getDataConnect>);
  vi.mocked(getFirestore).mockReturnValue({ collection: vi.fn(() => ({ doc: mockDoc })) } as ReturnType<typeof getFirestore>);
  vi.mocked(ProgressTrackerService).mockImplementation(() => ({
    updateStatus: mockUpdateStatus,
    updateProgress: vi.fn().mockResolvedValue(undefined),
  }) as unknown as ProgressTrackerService);
  mockDc.executeMutation.mockResolvedValue({});
});

describe('resetToPhase1', () => {
  beforeEach(() => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { debateSessions: [mockSession] } });
  });

  it('returns { status: ok }', async () => {
    const result = await (resetToPhase1 as unknown as Handler)(authedRequest('topic-1'));
    expect(result).toEqual({ status: 'ok' });
  });

  it('deletes persona profiles', async () => {
    await (resetToPhase1 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeletePersonaProfilesByTopicId', { topicId: 'topic-1' });
  });

  it('deletes persona interviews', async () => {
    await (resetToPhase1 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeletePersonaInterviewsByTopicId', { topicId: 'topic-1' });
  });

  it('deletes persona beliefs', async () => {
    await (resetToPhase1 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeletePersonaBeliefsByTopicId', { topicId: 'topic-1' });
  });

  it('deletes debate turns via session id', async () => {
    await (resetToPhase1 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeleteDebateTurnsBySession', { sessionId: 'session-1' });
  });

  it('deletes post debate comments via session id', async () => {
    await (resetToPhase1 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeletePostDebateCommentsBySession', { sessionId: 'session-1' });
  });

  it('deletes debate session by topic id', async () => {
    await (resetToPhase1 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeleteDebateSessionByTopicId', { topicId: 'topic-1' });
  });

  it('updates DB status to surveying', async () => {
    await (resetToPhase1 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith(
      'UpdateDebateTopicStatus',
      expect.objectContaining({ status: 'surveying' })
    );
  });

  it('updates Firestore status to surveying via tracker', async () => {
    await (resetToPhase1 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockUpdateStatus).toHaveBeenCalledWith('topic-1', 'surveying');
  });

  it('throws 404 when topic not found', async () => {
    mockDc.executeQuery.mockReset().mockResolvedValue({ data: { debateTopic: null } });
    await expect(
      (resetToPhase1 as unknown as Handler)(authedRequest('topic-1'))
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('returns ok when no session exists (skips turn/comment deletion)', async () => {
    mockDc.executeQuery.mockReset()
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { debateSessions: [] } });
    const result = await (resetToPhase1 as unknown as Handler)(authedRequest('topic-1'));
    expect(result).toEqual({ status: 'ok' });
    expect(mockDc.executeMutation).not.toHaveBeenCalledWith('DeleteDebateTurnsBySession', expect.anything());
  });
});

describe('resetToPhase2', () => {
  beforeEach(() => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { debateSessions: [mockSession] } });
  });

  it('returns { status: ok }', async () => {
    const result = await (resetToPhase2 as unknown as Handler)(authedRequest('topic-1'));
    expect(result).toEqual({ status: 'ok' });
  });

  it('does NOT delete persona profiles', async () => {
    await (resetToPhase2 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).not.toHaveBeenCalledWith('DeletePersonaProfilesByTopicId', expect.anything());
  });

  it('deletes persona interviews', async () => {
    await (resetToPhase2 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeletePersonaInterviewsByTopicId', { topicId: 'topic-1' });
  });

  it('deletes persona beliefs', async () => {
    await (resetToPhase2 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeletePersonaBeliefsByTopicId', { topicId: 'topic-1' });
  });

  it('updates DB status to generating_personas', async () => {
    await (resetToPhase2 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith(
      'UpdateDebateTopicStatus',
      expect.objectContaining({ status: 'generating_personas' })
    );
  });

  it('updates Firestore status to generating_personas via tracker', async () => {
    await (resetToPhase2 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockUpdateStatus).toHaveBeenCalledWith('topic-1', 'generating_personas');
  });

  it('throws 404 when topic not found', async () => {
    mockDc.executeQuery.mockReset().mockResolvedValue({ data: { debateTopic: null } });
    await expect(
      (resetToPhase2 as unknown as Handler)(authedRequest('topic-1'))
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('resetToPhase3', () => {
  beforeEach(() => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { debateSessions: [mockSession] } });
  });

  it('returns { status: ok }', async () => {
    const result = await (resetToPhase3 as unknown as Handler)(authedRequest('topic-1'));
    expect(result).toEqual({ status: 'ok' });
  });

  it('does NOT delete persona profiles', async () => {
    await (resetToPhase3 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).not.toHaveBeenCalledWith('DeletePersonaProfilesByTopicId', expect.anything());
  });

  it('does NOT delete persona interviews', async () => {
    await (resetToPhase3 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).not.toHaveBeenCalledWith('DeletePersonaInterviewsByTopicId', expect.anything());
  });

  it('deletes debate session by topic id', async () => {
    await (resetToPhase3 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeleteDebateSessionByTopicId', { topicId: 'topic-1' });
  });

  it('updates DB status to interviewing', async () => {
    await (resetToPhase3 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith(
      'UpdateDebateTopicStatus',
      expect.objectContaining({ status: 'interviewing' })
    );
  });

  it('updates Firestore status to interviewing via tracker', async () => {
    await (resetToPhase3 as unknown as Handler)(authedRequest('topic-1'));
    expect(mockUpdateStatus).toHaveBeenCalledWith('topic-1', 'interviewing');
  });

  it('throws 404 when topic not found', async () => {
    mockDc.executeQuery.mockReset().mockResolvedValue({ data: { debateTopic: null } });
    await expect(
      (resetToPhase3 as unknown as Handler)(authedRequest('topic-1'))
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});
