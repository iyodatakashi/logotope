import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));
vi.mock('../db/repository.js', () => ({
  createCompletedPersonaInterview: vi.fn().mockResolvedValue({ id: 'interview-1' }),
  createPersonaBelief: vi.fn().mockResolvedValue({ id: 'belief-1' }),
  createErrorPersonaInterview: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));

import Anthropic from '@anthropic-ai/sdk';
import { getFirestore } from 'firebase-admin/firestore';
import * as repo from '../db/repository.js';
import { InterviewerService } from './interviewer.js';
import { ProgressTrackerService } from './progress-tracker.js';
import type { PersonaAttributes } from '../types/index.js';

const mockCreate = vi.fn();
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ set: mockSet }));

const mockPersonas: PersonaAttributes[] = [
  { id: 'p-1', stakeholderRole: '市民', name: '田中太郎', age: 40, occupation: '会社員', background: '東京在住', interests: '安全・環境', stanceDirection: 'neutral' },
  { id: 'p-2', stakeholderRole: 'IT企業経営者', name: '佐藤花子', age: 45, occupation: '経営者', background: '起業家', interests: 'ビジネス・規制', stanceDirection: 'against' },
  { id: 'p-3', stakeholderRole: '労働組合', name: '山田一郎', age: 50, occupation: '組合員', background: '製造業', interests: '雇用保護', stanceDirection: 'conditional' },
];

function makeInterviewResponse(personaName: string) {
  return {
    content: [{
      type: 'tool_use',
      name: 'submit_interview',
      input: {
        interviewRecord: `${personaName}へのインタビュー記録`,
        initialBelief: `## 立場と根拠\n${personaName}の立場`,
      },
    }],
  };
}

let service: InterviewerService;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Anthropic).mockImplementation(() => ({ messages: { create: mockCreate } }) as unknown as Anthropic);
  vi.mocked(getFirestore).mockReturnValue({ collection: vi.fn(() => ({ doc: mockDoc })) } as ReturnType<typeof getFirestore>);
  vi.mocked(repo.createCompletedPersonaInterview).mockResolvedValue({ id: 'interview-1' });
  vi.mocked(repo.createPersonaBelief).mockResolvedValue({ id: 'belief-1' });
  vi.mocked(repo.createErrorPersonaInterview).mockResolvedValue(undefined);
  service = new InterviewerService();
});

describe('InterviewerService.interviewAll', () => {
  it('calls Claude API once per persona', async () => {
    mockCreate
      .mockResolvedValueOnce(makeInterviewResponse('田中太郎'))
      .mockResolvedValueOnce(makeInterviewResponse('佐藤花子'))
      .mockResolvedValueOnce(makeInterviewResponse('山田一郎'));

    const result = await service.interviewAll('topic-1', 'AI規制について', mockPersonas);

    expect(result.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('returns one InterviewResult per persona', async () => {
    mockCreate
      .mockResolvedValueOnce(makeInterviewResponse('田中太郎'))
      .mockResolvedValueOnce(makeInterviewResponse('佐藤花子'))
      .mockResolvedValueOnce(makeInterviewResponse('山田一郎'));

    const result = await service.interviewAll('topic-1', 'AI規制について', mockPersonas);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
  });

  it('partial failure does not affect other results (Promise.allSettled)', async () => {
    mockCreate
      .mockRejectedValueOnce(new Error('API rate limit'))
      .mockResolvedValueOnce(makeInterviewResponse('佐藤花子'))
      .mockResolvedValueOnce(makeInterviewResponse('山田一郎'));

    const result = await service.interviewAll('topic-1', 'AI規制について', mockPersonas);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
    expect(result.value[0].status).toBe('error');
    expect(result.value[1].status).toBe('completed');
    expect(result.value[2].status).toBe('completed');
  });

  it('saves PersonaInterview and PersonaBelief for completed interviews', async () => {
    mockCreate.mockResolvedValue(makeInterviewResponse('テスト'));

    await service.interviewAll('topic-1', 'AI規制について', [mockPersonas[0]]);

    expect(vi.mocked(repo.createCompletedPersonaInterview)).toHaveBeenCalledWith(
      'p-1',
      expect.any(String)
    );
    expect(vi.mocked(repo.createPersonaBelief)).toHaveBeenCalledWith(
      expect.objectContaining({ personaId: 'p-1', version: 0 })
    );
  });

  it('saves error record for failed interviews', async () => {
    mockCreate.mockRejectedValue(new Error('API error'));

    await service.interviewAll('topic-1', 'AI規制について', [mockPersonas[0]]);

    expect(vi.mocked(repo.createErrorPersonaInterview)).toHaveBeenCalledWith(
      'p-1',
      expect.any(String)
    );
  });
});

describe('InterviewerService.retryInterview', () => {
  it('returns ok with InterviewResult for single persona', async () => {
    mockCreate.mockResolvedValue(makeInterviewResponse('田中太郎'));

    const result = await service.retryInterview('topic-1', 'AI規制について', mockPersonas[0]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.personaId).toBe('p-1');
    expect(result.value.status).toBe('completed');
  });

  it('throws when Claude API fails', async () => {
    mockCreate.mockRejectedValue(new Error('API error'));

    await expect(service.retryInterview('topic-1', 'AI規制について', mockPersonas[0])).rejects.toThrow('API error');
  });
});

describe('InterviewerService DI', () => {
  it('accepts injected Anthropic client via constructor', async () => {
    const injectedClient = { messages: { create: mockCreate } } as unknown as Anthropic;
    const serviceWithDI = new InterviewerService(undefined, injectedClient);
    mockCreate.mockResolvedValue(makeInterviewResponse('田中太郎'));

    const result = await serviceWithDI.interviewAll('topic-1', 'AI規制について', [mockPersonas[0]]);

    expect(result.ok).toBe(true);
  });

  it('accepts injected ProgressTrackerService via constructor', async () => {
    const mockTracker = {
      updateStatus: vi.fn().mockResolvedValue(undefined),
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProgressTrackerService;
    const serviceWithTracker = new InterviewerService(mockTracker);
    mockCreate.mockResolvedValue(makeInterviewResponse('田中太郎'));

    await serviceWithTracker.interviewAll('topic-1', 'AI規制について', [mockPersonas[0]]);

    expect(mockTracker.updateStatus).toHaveBeenCalledWith('topic-1', 'interviewing', expect.any(String));
  });
});
