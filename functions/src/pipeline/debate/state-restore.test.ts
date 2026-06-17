import { describe, it, expect } from 'vitest';
import { restoreDebateState } from './state-restore.js';
import type { DebateTurn } from '../../types/repository.types.js';
import type { PersonaAttributes, PendingIntent } from '../../types/index.js';

const personas: PersonaAttributes[] = [
  { id: 'p1', stakeholderRole: '医師', name: '田中太郎', age: 45, occupation: '外科医', background: '', interests: '' },
  { id: 'p2', stakeholderRole: '患者', name: '鈴木花子', age: 35, occupation: '会社員', background: '', interests: '' },
];

const turn = (turnIndex: number, speakerType: 'facilitator' | 'persona', personaId?: string): DebateTurn => ({
  id: `t${turnIndex}`,
  sessionId: 's1',
  turnIndex,
  speakerType,
  personaId,
  content: `発言${turnIndex}`,
  createdAt: '',
});

const beliefs = () => new Map([
  ['p1', { content: '信念1', version: 0 }],
  ['p2', { content: '信念2', version: 1 }],
]);

const noIntents = new Map<string, PendingIntent[]>();

const baseTurns: DebateTurn[] = [
  turn(0, 'facilitator'),
  turn(1, 'persona', 'p1'),
  turn(2, 'persona', 'p2'),
  turn(3, 'facilitator'),
  turn(4, 'persona', 'p1'),
];

describe('restoreDebateState', () => {
  it('保存済みターンから発言数・沈黙数・最終ファシリテーターターン・直前話者・次ターン番号を復元する', () => {
    const state = restoreDebateState(baseTurns, personas, noIntents, beliefs());

    expect(state.currentTurnIndex).toBe(5);
    expect(state.speakCount.get('p1')).toBe(2);
    expect(state.speakCount.get('p2')).toBe(1);
    expect(state.silenceMap.get('p1')).toBe(0); // 最終発言 turn 4
    expect(state.silenceMap.get('p2')).toBe(2); // 最終発言 turn 2 → 5-2-1
    expect(state.lastFacilitatorTurnIndex).toBe(3);
    expect(state.lastSpeakerId).toBe('p1');
    expect(state.turns).toHaveLength(5);
  });

  it('ターンが空の場合は初期状態を返す', () => {
    const state = restoreDebateState([], personas, noIntents, beliefs());

    expect(state.currentTurnIndex).toBe(0);
    expect(state.speakCount.get('p1')).toBe(0);
    expect(state.silenceMap.get('p1')).toBe(0);
    expect(state.lastFacilitatorTurnIndex).toBe(0);
    expect(state.lastSpeakerId).toBeUndefined();
    expect(state.targetPersona).toBeUndefined();
    expect(state.pairConversationTurns).toBe(0);
  });

  it('永続化済みキューを取り込み、8ターン超過のエントリを失効させる', () => {
    const turns = [turn(0, 'facilitator'), turn(11, 'persona', 'p1')];
    const persistedPendingIntents = new Map<string, PendingIntent[]>([
      ['p2', [
        { triggerTurnIndex: 3, intentSummary: '失効する意図' },  // 12-3=9 > 8
        { triggerTurnIndex: 4, intentSummary: '残る意図' },       // 12-4=8 <= 8
      ]],
    ]);

    const state = restoreDebateState(turns, personas, persistedPendingIntents, beliefs());

    expect(state.pendingIntents.get('p2')).toEqual([
      { triggerTurnIndex: 4, intentSummary: '残る意図' },
    ]);
  });

  it('全エントリが失効したペルソナはキューから取り除かれる', () => {
    const turns = [turn(20, 'persona', 'p1')];
    const persistedPendingIntents = new Map<string, PendingIntent[]>([
      ['p2', [{ triggerTurnIndex: 1, intentSummary: '古い意図' }]],
    ]);

    const state = restoreDebateState(turns, personas, persistedPendingIntents, beliefs());

    expect(state.pendingIntents.has('p2')).toBe(false);
  });

  it('currentBeliefs が状態に引き継がれる', () => {
    const state = restoreDebateState(baseTurns, personas, noIntents, beliefs());

    expect(state.currentBeliefs.get('p2')).toEqual({ content: '信念2', version: 1 });
  });

  it('決定性: 同一入力から常に同一の状態を生成する', () => {
    const intents = new Map<string, PendingIntent[]>([
      ['p2', [{ triggerTurnIndex: 2, intentSummary: '意図' }]],
    ]);

    const first = restoreDebateState(baseTurns, personas, intents, beliefs());
    const second = restoreDebateState(baseTurns, personas, intents, beliefs());

    expect(second).toEqual(first);
  });

  it('直近指名の復元: 最後のファシリテーターターンの targetPersonaId から指名を復元する', () => {
    const turns = [...baseTurns, { ...turn(5, 'facilitator'), targetPersonaId: 'p2' }];
    const state = restoreDebateState(turns, personas, noIntents, beliefs());

    expect(state.targetPersona).toEqual({ personaId: 'p2', targetedBy: 'facilitator' });
  });

  it('直近指名の復元: 最後のペルソナターンの targetPersonaId はペルソナ指名として復元する', () => {
    const turns = [...baseTurns, { ...turn(5, 'persona', 'p2'), targetPersonaId: 'p1' }];
    const state = restoreDebateState(turns, personas, noIntents, beliefs());

    expect(state.targetPersona).toEqual({ personaId: 'p1', targetedBy: 'persona' });
  });

  it('最後のターンに targetPersonaId がない場合 targetPersona は復元されない', () => {
    const turns = [
      ...baseTurns,
      { ...turn(5, 'facilitator'), content: '次の章では、鈴木花子さんから伺います。' },
    ];
    const state = restoreDebateState(turns, personas, noIntents, beliefs());

    expect(state.targetPersona).toBeUndefined();
  });

  it('targetPersonaId が参加ペルソナに存在しない場合 targetPersona は復元されない', () => {
    const turns = [...baseTurns, { ...turn(5, 'facilitator'), targetPersonaId: 'unknown' }];
    const state = restoreDebateState(turns, personas, noIntents, beliefs());

    expect(state.targetPersona).toBeUndefined();
  });

  it('入力のターン順序が不定でも turnIndex 順に復元する', () => {
    const shuffled = [baseTurns[3], baseTurns[0], baseTurns[4], baseTurns[2], baseTurns[1]];
    const state = restoreDebateState(shuffled, personas, noIntents, beliefs());

    expect(state.currentTurnIndex).toBe(5);
    expect(state.lastSpeakerId).toBe('p1');
    expect(state.turns.map(t => t.turnIndex)).toEqual([0, 1, 2, 3, 4]);
  });
});
