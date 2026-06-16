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

const baseTurns: DebateTurn[] = [
  turn(0, 'facilitator'),
  turn(1, 'persona', 'p1'),
  turn(2, 'persona', 'p2'),
  turn(3, 'facilitator'),
  turn(4, 'persona', 'p1'),
];

describe('restoreDebateState', () => {
  it('保存済みターンから発言数・沈黙数・最終ファシリテーターターン・直前話者・次ターン番号を復元する', () => {
    const state = restoreDebateState({
      turns: baseTurns,
      personas,
      persistedPendingIntents: new Map(),
      currentBeliefs: beliefs(),
    });

    expect(state.currentTurnIndex).toBe(5);
    expect(state.speakCount.get('p1')).toBe(2);
    expect(state.speakCount.get('p2')).toBe(1);
    expect(state.silenceMap.get('p1')).toBe(0); // 最終発言 turn 4
    expect(state.silenceMap.get('p2')).toBe(2); // 最終発言 turn 2 → 5-2-1
    expect(state.lastFacilitatorTurnIndex).toBe(3);
    expect(state.lastSpeakerId).toBe('p1');
    expect(state.history).toHaveLength(5);
  });

  it('ターンが空の場合は初期状態を返す', () => {
    const state = restoreDebateState({
      turns: [],
      personas,
      persistedPendingIntents: new Map(),
      currentBeliefs: beliefs(),
    });

    expect(state.currentTurnIndex).toBe(0);
    expect(state.speakCount.get('p1')).toBe(0);
    expect(state.silenceMap.get('p1')).toBe(0);
    expect(state.lastFacilitatorTurnIndex).toBe(0);
    expect(state.lastSpeakerId).toBeUndefined();
    expect(state.pendingAddress).toBeUndefined();
    expect(state.consecutiveDirectExchanges).toBe(0);
    expect(state.engagementSignals).toEqual([]);
  });

  it('永続化済みキューを取り込み、8ターン超過のエントリを失効させる', () => {
    // 最終ターン 11 → currentTurnIndex 12
    const turns = [turn(0, 'facilitator'), turn(11, 'persona', 'p1')];
    const persistedPendingIntents = new Map<string, PendingIntent[]>([
      ['p2', [
        { triggerTurnIndex: 3, intentSummary: '失効する意図' },  // 12-3=9 > 8
        { triggerTurnIndex: 4, intentSummary: '残る意図' },       // 12-4=8 <= 8
      ]],
    ]);

    const state = restoreDebateState({
      turns,
      personas,
      persistedPendingIntents,
      currentBeliefs: beliefs(),
    });

    expect(state.pendingIntents.get('p2')).toEqual([
      { triggerTurnIndex: 4, intentSummary: '残る意図' },
    ]);
  });

  it('全エントリが失効したペルソナはキューから取り除かれる', () => {
    const turns = [turn(20, 'persona', 'p1')]; // currentTurnIndex 21
    const persistedPendingIntents = new Map<string, PendingIntent[]>([
      ['p2', [{ triggerTurnIndex: 1, intentSummary: '古い意図' }]],
    ]);

    const state = restoreDebateState({
      turns,
      personas,
      persistedPendingIntents,
      currentBeliefs: beliefs(),
    });

    expect(state.pendingIntents.has('p2')).toBe(false);
  });

  it('currentBeliefs が状態に引き継がれる', () => {
    const state = restoreDebateState({
      turns: baseTurns,
      personas,
      persistedPendingIntents: new Map(),
      currentBeliefs: beliefs(),
    });

    expect(state.currentBeliefs.get('p2')).toEqual({ content: '信念2', version: 1 });
  });

  it('決定性: 同一入力から常に同一の状態を生成する', () => {
    const input = () => ({
      turns: baseTurns,
      personas,
      persistedPendingIntents: new Map<string, PendingIntent[]>([
        ['p2', [{ triggerTurnIndex: 2, intentSummary: '意図' }]],
      ]),
      currentBeliefs: beliefs(),
    });

    const first = restoreDebateState(input());
    const second = restoreDebateState(input());

    expect(second).toEqual(first);
  });

  it('直近指名の復元: 最後のファシリテーターターンの addressedPersonaId から指名を復元する', () => {
    const turns = [
      ...baseTurns,
      { ...turn(5, 'facilitator'), addressedPersonaId: 'p2' },
    ];
    const state = restoreDebateState({
      turns,
      personas,
      persistedPendingIntents: new Map(),
      currentBeliefs: beliefs(),
    });

    expect(state.pendingAddress).toEqual({ personaId: 'p2', byFacilitator: true });
  });

  it('直近指名の復元: 最後のペルソナターンの addressedPersonaId は直接質問（byFacilitator: false）として復元する', () => {
    const turns = [
      ...baseTurns,
      { ...turn(5, 'persona', 'p2'), addressedPersonaId: 'p1' },
    ];
    const state = restoreDebateState({
      turns,
      personas,
      persistedPendingIntents: new Map(),
      currentBeliefs: beliefs(),
    });

    expect(state.pendingAddress).toEqual({ personaId: 'p1', byFacilitator: false });
  });

  it('最後のターンに addressedPersonaId がない場合 pendingAddress は復元されない', () => {
    const turns = [
      ...baseTurns,
      { ...turn(5, 'facilitator'), content: '次の章では、鈴木花子さんから伺います。' },
    ];
    const state = restoreDebateState({
      turns,
      personas,
      persistedPendingIntents: new Map(),
      currentBeliefs: beliefs(),
    });

    // 本文にペルソナ名があっても名前マッチは行わない（ID のみで判定）
    expect(state.pendingAddress).toBeUndefined();
  });

  it('addressedPersonaId が参加ペルソナに存在しない場合 pendingAddress は復元されない', () => {
    const turns = [
      ...baseTurns,
      { ...turn(5, 'facilitator'), addressedPersonaId: 'unknown' },
    ];
    const state = restoreDebateState({
      turns,
      personas,
      persistedPendingIntents: new Map(),
      currentBeliefs: beliefs(),
    });

    expect(state.pendingAddress).toBeUndefined();
  });

  it('入力のターン順序が不定でも turnIndex 順に復元する', () => {
    const shuffled = [baseTurns[3], baseTurns[0], baseTurns[4], baseTurns[2], baseTurns[1]];
    const state = restoreDebateState({
      turns: shuffled,
      personas,
      persistedPendingIntents: new Map(),
      currentBeliefs: beliefs(),
    });

    expect(state.currentTurnIndex).toBe(5);
    expect(state.lastSpeakerId).toBe('p1');
    expect(state.history.map(t => t.turnIndex)).toEqual([0, 1, 2, 3, 4]);
  });
});
