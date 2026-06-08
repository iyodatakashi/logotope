import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/data-connect', () => ({
  getDataConnect: vi.fn(),
}));

import * as repo from './repository.js';
import { getDataConnect } from 'firebase-admin/data-connect';

const mockDc = {
  executeQuery: vi.fn(),
  executeMutation: vi.fn(),
};

beforeEach(() => {
  vi.mocked(getDataConnect).mockReturnValue(mockDc as ReturnType<typeof getDataConnect>);
  vi.clearAllMocks();
});

describe('createTopic', () => {
  it('executes CreateDebateTopic mutation with title and returns id', async () => {
    mockDc.executeMutation.mockResolvedValue({
      data: { debateTopic_insert: { id: 'topic-1' } },
    });
    const result = await repo.createTopic('AI規制について');
    expect(mockDc.executeMutation).toHaveBeenCalledWith('CreateDebateTopic', { title: 'AI規制について' });
    expect(result.id).toBe('topic-1');
  });
});

describe('listTopics', () => {
  it('executes GetTopics query and returns topic array', async () => {
    const mockTopics = [
      { id: '1', title: 'Topic A', status: 'pending', createdAt: '2024-01-01', updatedAt: '2024-01-01' },
    ];
    mockDc.executeQuery.mockResolvedValue({ data: { debateTopics: mockTopics } });
    const result = await repo.listTopics();
    expect(mockDc.executeQuery).toHaveBeenCalledWith('GetTopics');
    expect(result).toEqual(mockTopics);
  });
});

describe('createPersonaBelief', () => {
  it('creates initial belief (version=0) without triggeredByTurnId', async () => {
    mockDc.executeMutation.mockResolvedValue({
      data: { personaBelief_insert: { id: 'belief-1' } },
    });
    const result = await repo.createPersonaBelief({
      personaId: 'persona-1',
      version: 0,
      content: '## 立場\n賛成',
    });
    expect(mockDc.executeMutation).toHaveBeenCalledWith('CreatePersonaBelief', {
      personaId: 'persona-1',
      version: 0,
      content: '## 立場\n賛成',
    });
    expect(result.id).toBe('belief-1');
  });

  it('creates updated belief (version>0) with triggeredByTurnId', async () => {
    mockDc.executeMutation.mockResolvedValue({
      data: { personaBelief_insert: { id: 'belief-2' } },
    });
    await repo.createPersonaBelief({
      personaId: 'persona-1',
      version: 1,
      content: '## 更新後の立場\n部分的に同意',
      changeType: 'partial_acceptance',
      changeSummary: '山田さんの経済的懸念に一理あると感じた',
      triggeredByTurnId: 'turn-5',
    });
    expect(mockDc.executeMutation).toHaveBeenCalledWith('CreatePersonaBelief', {
      personaId: 'persona-1',
      version: 1,
      content: '## 更新後の立場\n部分的に同意',
      changeType: 'partial_acceptance',
      changeSummary: '山田さんの経済的懸念に一理あると感じた',
      triggeredByTurnId: 'turn-5',
    });
  });
});

describe('createDebateTurn', () => {
  it('creates a facilitator turn without personaId', async () => {
    mockDc.executeMutation.mockResolvedValue({
      data: { debateTurn_insert: { id: 'turn-1' } },
    });
    const result = await repo.createDebateTurn({
      sessionId: 'session-1',
      turnIndex: 0,
      speakerType: 'facilitator',
      content: '本日の討論を始めます',
    });
    expect(mockDc.executeMutation).toHaveBeenCalledWith('CreateDebateTurn', {
      sessionId: 'session-1',
      turnIndex: 0,
      speakerType: 'facilitator',
      content: '本日の討論を始めます',
    });
    expect(result.id).toBe('turn-1');
  });

  it('creates a persona turn with personaId', async () => {
    mockDc.executeMutation.mockResolvedValue({
      data: { debateTurn_insert: { id: 'turn-2' } },
    });
    await repo.createDebateTurn({
      sessionId: 'session-1',
      turnIndex: 1,
      speakerType: 'persona',
      personaId: 'persona-1',
      content: '私は反対です',
    });
    expect(mockDc.executeMutation).toHaveBeenCalledWith('CreateDebateTurn', {
      sessionId: 'session-1',
      turnIndex: 1,
      speakerType: 'persona',
      personaId: 'persona-1',
      content: '私は反対です',
    });
  });
});

describe('getPersonaBeliefsByPersonaId', () => {
  it('returns beliefs ordered by version ascending', async () => {
    const mockBeliefs = [
      { id: 'b1', personaId: 'p1', version: 0, content: '初期', createdAt: '2024-01-01' },
      { id: 'b2', personaId: 'p1', version: 1, content: '変化後', changeType: 'opinion_change', createdAt: '2024-01-02' },
    ];
    mockDc.executeQuery.mockResolvedValue({ data: { personaBeliefs: mockBeliefs } });
    const result = await repo.getPersonaBeliefsByPersonaId('p1');
    expect(mockDc.executeQuery).toHaveBeenCalledWith('GetPersonaBeliefsByPersonaId', { personaId: 'p1' });
    expect(result).toHaveLength(2);
    expect(result[0].version).toBe(0);
    expect(result[1].version).toBe(1);
  });
});

describe('deletePersonaProfilesByTopicId', () => {
  it('executes DeletePersonaProfilesByTopicId mutation with topicId', async () => {
    mockDc.executeMutation.mockResolvedValue({});
    await repo.deletePersonaProfilesByTopicId('topic-1');
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeletePersonaProfilesByTopicId', { topicId: 'topic-1' });
  });
});

describe('deletePersonaInterviewsByTopicId', () => {
  it('executes DeletePersonaInterviewsByTopicId mutation with topicId', async () => {
    mockDc.executeMutation.mockResolvedValue({});
    await repo.deletePersonaInterviewsByTopicId('topic-1');
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeletePersonaInterviewsByTopicId', { topicId: 'topic-1' });
  });
});

describe('deletePersonaBeliefsByTopicId', () => {
  it('executes DeletePersonaBeliefsByTopicId mutation with topicId', async () => {
    mockDc.executeMutation.mockResolvedValue({});
    await repo.deletePersonaBeliefsByTopicId('topic-1');
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeletePersonaBeliefsByTopicId', { topicId: 'topic-1' });
  });
});

describe('deleteDebateSessionByTopicId', () => {
  it('executes DeleteDebateSessionByTopicId mutation with topicId', async () => {
    mockDc.executeMutation.mockResolvedValue({});
    await repo.deleteDebateSessionByTopicId('topic-1');
    expect(mockDc.executeMutation).toHaveBeenCalledWith('DeleteDebateSessionByTopicId', { topicId: 'topic-1' });
  });
});
