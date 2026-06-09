import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));
vi.mock('../db/repository.js', () => ({
  createPersonaProfile: vi.fn().mockResolvedValue({ id: 'persona-1' }),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));

import Anthropic from '@anthropic-ai/sdk';
import { getFirestore } from 'firebase-admin/firestore';
import * as repo from '../db/repository.js';
import { PersonaGeneratorService } from './persona-generator.js';
import { ProgressTrackerService } from './progress-tracker.js';
import type { Stakeholder } from '../types/index.js';

const mockCreate = vi.fn();
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ set: mockSet }));

const mockStakeholders: Stakeholder[] = [
  { role: '一般市民', reason: '直接影響を受ける', mainInterests: ['安全'], stanceDirection: 'neutral', minorityLevel: 'low' },
  { role: 'IT企業経営者', reason: 'ビジネスへの影響', mainInterests: ['規制コスト'], stanceDirection: 'against', minorityLevel: 'medium' },
  { role: '労働組合', reason: '雇用保護', mainInterests: ['雇用'], stanceDirection: 'conditional', minorityLevel: 'medium' },
];

function makePersonaResponse(stakeholders: Stakeholder[]) {
  const personas = stakeholders.map((s, i) => ({
    stakeholderRole: s.role,
    name: `テスト太郎${i + 1}`,
    age: 35 + i * 5,
    occupation: `職業${i + 1}`,
    background: `背景${i + 1}`,
    interests: `関心事${i + 1}`,
    stanceDirection: s.stanceDirection,
  }));
  return {
    content: [{ type: 'tool_use', name: 'submit_personas', input: { personas } }],
  };
}

let service: PersonaGeneratorService;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Anthropic).mockImplementation(() => ({ messages: { create: mockCreate } }) as unknown as Anthropic);
  vi.mocked(getFirestore).mockReturnValue({ collection: vi.fn(() => ({ doc: mockDoc })) } as ReturnType<typeof getFirestore>);
  vi.mocked(repo.createPersonaProfile).mockResolvedValue({ id: 'persona-1' });
  service = new PersonaGeneratorService();
});

describe('PersonaGeneratorService', () => {
  it('returns one persona per stakeholder', async () => {
    mockCreate.mockResolvedValue(makePersonaResponse(mockStakeholders));

    const result = await service.generate('topic-1', 'AI規制について', mockStakeholders);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(mockStakeholders.length);
  });

  it('each persona has all required fields', async () => {
    mockCreate.mockResolvedValue(makePersonaResponse(mockStakeholders));

    const result = await service.generate('topic-1', 'AI規制について', mockStakeholders);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const p of result.value) {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('stakeholderRole');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('age');
      expect(p).toHaveProperty('occupation');
      expect(p).toHaveProperty('background');
      expect(p).toHaveProperty('interests');
      expect(p).toHaveProperty('stanceDirection');
    }
  });

  it('saves each persona to repository', async () => {
    mockCreate.mockResolvedValue(makePersonaResponse(mockStakeholders));

    await service.generate('topic-1', 'AI規制について', mockStakeholders);

    expect(vi.mocked(repo.createPersonaProfile)).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 'topic-1' })
    );
    expect(vi.mocked(repo.createPersonaProfile)).toHaveBeenCalledTimes(mockStakeholders.length);
  });

  it('throws when Claude API fails', async () => {
    mockCreate.mockRejectedValue(new Error('API error'));

    await expect(service.generate('topic-1', 'AI規制について', mockStakeholders)).rejects.toThrow('API error');
  });

  it('accepts injected Anthropic client via constructor', async () => {
    const injectedClient = { messages: { create: mockCreate } } as unknown as Anthropic;
    const serviceWithDI = new PersonaGeneratorService(undefined, injectedClient);
    mockCreate.mockResolvedValue(makePersonaResponse(mockStakeholders));

    const result = await serviceWithDI.generate('topic-1', 'AI規制について', mockStakeholders);

    expect(result.ok).toBe(true);
  });

  it('accepts injected ProgressTrackerService via constructor', async () => {
    const mockTracker = {
      updateStatus: vi.fn().mockResolvedValue(undefined),
      updateProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProgressTrackerService;
    const serviceWithTracker = new PersonaGeneratorService(mockTracker);
    mockCreate.mockResolvedValue(makePersonaResponse(mockStakeholders));

    await serviceWithTracker.generate('topic-1', 'AI規制について', mockStakeholders);

    expect(mockTracker.updateStatus).toHaveBeenCalledWith('topic-1', 'generating_personas', expect.any(String));
  });

  it('returns VALIDATION_ERROR when stakeholders list is empty', async () => {
    const result = await service.generate('topic-1', 'AI規制について', []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});
