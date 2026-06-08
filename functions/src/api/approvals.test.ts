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
import { approveStakeholders } from './stakeholders.js';
import { approvePersonas } from './personas.js';
import { approveInterviews } from './interviews.js';

const mockDc = { executeQuery: vi.fn(), executeMutation: vi.fn() };
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ set: mockSet }));
const mockUpdateStatus = vi.fn().mockResolvedValue(undefined);

const mockTopic = { id: 'topic-1', title: 'AI規制について', status: 'surveying', createdAt: '2024-01-01', updatedAt: '2024-01-01' };
const mockMap = { id: 'sm-1', topicId: 'topic-1', content: '[]', approved: false, createdAt: '2024-01-01' };

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

describe('approveStakeholders', () => {
  beforeEach(() => {
    mockDc.executeQuery
      .mockResolvedValueOnce({ data: { debateTopic: mockTopic } })
      .mockResolvedValueOnce({ data: { stakeholderMaps: [mockMap] } });
  });

  it('returns { status: ok }', async () => {
    const result = await (approveStakeholders as unknown as Handler)(authedRequest('topic-1'));
    expect(result).toEqual({ status: 'ok' });
  });

  it('approves the stakeholder map', async () => {
    await (approveStakeholders as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith('ApproveStakeholderMap', { id: 'sm-1' });
  });

  it('updates topic status to generating_personas via repo', async () => {
    await (approveStakeholders as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith(
      'UpdateDebateTopicStatus',
      expect.objectContaining({ status: 'generating_personas' })
    );
  });

  it('updates Firestore status to generating_personas via tracker', async () => {
    await (approveStakeholders as unknown as Handler)(authedRequest('topic-1'));
    expect(mockUpdateStatus).toHaveBeenCalledWith('topic-1', 'generating_personas');
  });

  it('throws 404 when topic not found', async () => {
    mockDc.executeQuery.mockReset().mockResolvedValue({ data: { debateTopic: null } });
    await expect(
      (approveStakeholders as unknown as Handler)(authedRequest('topic-1'))
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('approvePersonas', () => {
  beforeEach(() => {
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopic: mockTopic } });
  });

  it('returns { status: ok }', async () => {
    const result = await (approvePersonas as unknown as Handler)(authedRequest('topic-1'));
    expect(result).toEqual({ status: 'ok' });
  });

  it('calls approvePersonaProfiles', async () => {
    await (approvePersonas as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith('ApprovePersonaProfiles', { topicId: 'topic-1' });
  });

  it('updates topic status to interviewing via repo', async () => {
    await (approvePersonas as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith(
      'UpdateDebateTopicStatus',
      expect.objectContaining({ status: 'interviewing' })
    );
  });

  it('updates Firestore status to interviewing via tracker', async () => {
    await (approvePersonas as unknown as Handler)(authedRequest('topic-1'));
    expect(mockUpdateStatus).toHaveBeenCalledWith('topic-1', 'interviewing');
  });

  it('throws 404 when topic not found', async () => {
    mockDc.executeQuery.mockReset().mockResolvedValue({ data: { debateTopic: null } });
    await expect(
      (approvePersonas as unknown as Handler)(authedRequest('topic-1'))
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('approveInterviews', () => {
  beforeEach(() => {
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopic: mockTopic } });
  });

  it('returns { status: ok }', async () => {
    const result = await (approveInterviews as unknown as Handler)(authedRequest('topic-1'));
    expect(result).toEqual({ status: 'ok' });
  });

  it('updates topic status to debating via repo', async () => {
    await (approveInterviews as unknown as Handler)(authedRequest('topic-1'));
    expect(mockDc.executeMutation).toHaveBeenCalledWith(
      'UpdateDebateTopicStatus',
      expect.objectContaining({ status: 'debating' })
    );
  });

  it('updates Firestore status to debating via tracker', async () => {
    await (approveInterviews as unknown as Handler)(authedRequest('topic-1'));
    expect(mockUpdateStatus).toHaveBeenCalledWith('topic-1', 'debating');
  });

  it('throws 404 when topic not found', async () => {
    mockDc.executeQuery.mockReset().mockResolvedValue({ data: { debateTopic: null } });
    await expect(
      (approveInterviews as unknown as Handler)(authedRequest('topic-1'))
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});
