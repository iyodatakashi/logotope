/**
 * getDebateState の状態導出が「確定 turns[] のみ」に依存し、生成 status の付与に影響されないことを検証する（1.8/3.1）。
 * 末尾評価移行で確定ターンに status='evaluating' が載っても、話者統計・沈黙度・直前話者・frontier は不変。
 */
import { describe, it, expect } from 'vitest';
import { getDebateState } from '../../../pipeline/debate/debate-state.js';
import type { DebateTurn } from '../../../types/turn.types.js';
import type { Persona } from '../../../types/persona.types.js';
import type { QueuedIntent } from '../../../types/debate.types.js';

const persona = (id: string): Persona => ({ id, name: id.toUpperCase() }) as Persona;

const turn = (id: string, personaId: string, status?: 'evaluating'): DebateTurn => ({
	id,
	speakerType: 'persona',
	personaId,
	content: `${personaId} の発言`,
	createdAt: '' as unknown as DebateTurn['createdAt'],
	...(status ? { status } : {})
});

const emptyQueue: ReadonlyMap<string, ReadonlyArray<QueuedIntent>> = new Map();

describe('getDebateState は status に影響されず確定 turns のみから導出する（1.8/3.1）', () => {
	const personas = [persona('p1'), persona('p2')];

	it('確定ターンへの status=evaluating 付与は speakCount / 直前話者 / frontier を変えない', () => {
		const withoutStatus = [turn('t1', 'p1'), turn('t2', 'p2')];
		const withStatus = [turn('t1', 'p1'), turn('t2', 'p2', 'evaluating')];

		const base = getDebateState(withoutStatus, personas, emptyQueue);
		const marked = getDebateState(withStatus, personas, emptyQueue);

		expect(marked.turns.length).toBe(base.turns.length); // frontier 不変
		expect(marked.lastSpeakerId).toBe(base.lastSpeakerId); // 直前話者 p2 不変
		expect([...marked.speakCount.entries()]).toEqual([...base.speakCount.entries()]);
		expect([...marked.silenceMap.entries()]).toEqual([...base.silenceMap.entries()]);
	});
});
