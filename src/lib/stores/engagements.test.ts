import { describe, it, expect } from 'vitest';
import { buildEngagementsMap } from './engagements.svelte.js';
import type { EngagementHistoryEntry } from '$lib/models/engagement/engagement.types.js';

type EngagementDocInput = { personaId: string; history: Record<string, EngagementHistoryEntry> };

describe('buildEngagementsMap', () => {
  it('空の入力で空のMapを返す', () => {
    const result = buildEngagementsMap([]);
    expect(result.size).toBe(0);
  });

  it('複数ペルソナの履歴をturnIndexでグループ化する', () => {
    const docs: EngagementDocInput[] = [
      {
        personaId: 'p1',
        history: {
          '1': { score: 4, mode: 'opinion' as const },
          '2': { score: 2, mode: 'reaction' as const },
        },
      },
      {
        personaId: 'p2',
        history: {
          '1': { score: 3, mode: 'reaction' as const },
        },
      },
    ];
    const result = buildEngagementsMap(docs);
    expect(result.size).toBe(2);
    expect(result.get(1)).toHaveLength(2);
    expect(result.get(2)).toHaveLength(1);
  });

  it('各エントリにpersonaIdとturnIndexが付与される', () => {
    const docs = [
      { personaId: 'p99', history: { '5': { score: 3, mode: 'opinion' as const } } },
    ];
    const result = buildEngagementsMap(docs);
    expect(result.get(5)?.[0].personaId).toBe('p99');
    expect(result.get(5)?.[0].turnIndex).toBe(5);
  });

  it('historyが空のペルソナはMapに追加しない', () => {
    const docs = [{ personaId: 'p1', history: {} }];
    const result = buildEngagementsMap(docs);
    expect(result.size).toBe(0);
  });

  it('同じturnIndexのエントリを蓄積する（上書きしない）', () => {
    const docs = [
      { personaId: 'p1', history: { '3': { score: 5, mode: 'opinion' as const } } },
      { personaId: 'p2', history: { '3': { score: 2, mode: 'none' as const } } },
    ];
    const result = buildEngagementsMap(docs);
    const entries = result.get(3);
    expect(entries).toHaveLength(2);
    expect(entries?.map(e => e.personaId)).toContain('p1');
    expect(entries?.map(e => e.personaId)).toContain('p2');
  });
});
