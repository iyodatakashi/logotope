import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));
vi.mock('firebase-admin/data-connect', () => ({
  getDataConnect: vi.fn(),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));

import Anthropic from '@anthropic-ai/sdk';
import { getDataConnect } from 'firebase-admin/data-connect';
import { getFirestore } from 'firebase-admin/firestore';
import { StakeholderAnalyzerService } from './stakeholder-analyzer.js';
import { ProgressTrackerService } from './progress-tracker.js';

const mockCreate = vi.fn();
const mockDc = { executeMutation: vi.fn(), executeQuery: vi.fn() };
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ set: mockSet }));

let service: StakeholderAnalyzerService;

function makeStakeholderResponse(count = 6) {
  const stakeholders = Array.from({ length: count }, (_, i) => ({
    role: `ステークホルダー${i + 1}`,
    reason: `理由${i + 1}`,
    mainInterests: [`関心事${i + 1}`],
    stanceDirection: i % 2 === 0 ? 'pro' : 'against',
    minorityLevel: 'medium',
  }));
  return {
    content: [{
      type: 'tool_use',
      name: 'submit_stakeholders',
      input: { stakeholders },
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Anthropic).mockImplementation(() => ({
    messages: { create: mockCreate },
  }) as unknown as Anthropic);
  vi.mocked(getDataConnect).mockReturnValue(mockDc as ReturnType<typeof getDataConnect>);
  vi.mocked(getFirestore).mockReturnValue({ collection: vi.fn(() => ({ doc: mockDoc })) } as ReturnType<typeof getFirestore>);
  mockDc.executeMutation.mockResolvedValue({ data: { stakeholderMap_insert: { id: 'sm-1' } } });
  service = new StakeholderAnalyzerService();
});

describe('StakeholderAnalyzerService', () => {

  it('returns ok with 6 stakeholders', async () => {
    mockCreate.mockResolvedValue(makeStakeholderResponse(6));

    const result = await service.analyze('topic-1', 'AI規制について');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThanOrEqual(5);
  });

  it('each stakeholder has all required fields', async () => {
    mockCreate.mockResolvedValue(makeStakeholderResponse(5));

    const result = await service.analyze('topic-1', 'AI規制について');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const s of result.value) {
      expect(s).toHaveProperty('role');
      expect(s).toHaveProperty('reason');
      expect(s).toHaveProperty('mainInterests');
      expect(s).toHaveProperty('stanceDirection');
      expect(s).toHaveProperty('minorityLevel');
    }
  });

  it('saves result to StakeholderMap via repository', async () => {
    mockCreate.mockResolvedValue(makeStakeholderResponse(5));

    await service.analyze('topic-1', 'AI規制について');

    expect(mockDc.executeMutation).toHaveBeenCalledWith(
      'CreateStakeholderMap',
      expect.objectContaining({ topicId: 'topic-1' })
    );
  });

  it('throws when Claude API fails', async () => {
    mockCreate.mockRejectedValue(new Error('API error'));

    await expect(service.analyze('topic-1', 'AI規制について')).rejects.toThrow('API error');
  });

  it('accepts injected Anthropic client via constructor', async () => {
    const injectedClient = { messages: { create: mockCreate } } as unknown as Anthropic;
    const serviceWithDI = new StakeholderAnalyzerService(undefined, injectedClient);
    mockCreate.mockResolvedValue(makeStakeholderResponse(5));

    const result = await serviceWithDI.analyze('topic-1', 'AI規制について');

    expect(result.ok).toBe(true);
  });

  it('accepts injected ProgressTrackerService via constructor', async () => {
    const mockTracker = {
      updateStatus: vi.fn().mockResolvedValue(undefined),
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProgressTrackerService;
    const serviceWithTracker = new StakeholderAnalyzerService(mockTracker);
    mockCreate.mockResolvedValue(makeStakeholderResponse(5));

    await serviceWithTracker.analyze('topic-1', 'AI規制について');

    expect(mockTracker.updateStatus).toHaveBeenCalledWith('topic-1', 'surveying', expect.any(String));
  });

  it('updates Firestore status to surveying on start', async () => {
    mockCreate.mockResolvedValue(makeStakeholderResponse(5));

    await service.analyze('topic-1', 'AI規制について');

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'surveying' }),
    );
  });
});
