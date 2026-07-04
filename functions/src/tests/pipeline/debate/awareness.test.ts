import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { Persona } from '../../../types/persona.types.js';
import type { AwarenessEvent } from '../../../types/debate.types.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined,
		nextId: 0
	}
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' },
	FieldValue: {
		delete: () => holder.mock!.FieldValue.delete(),
		arrayUnion: (...v: unknown[]) => holder.mock!.FieldValue.arrayUnion(...v)
	}
}));

vi.mock('nanoid', () => ({ nanoid: () => `aw-${holder.nextId++}` }));

import {
	getInitialBelief,
	appendAwareness,
	rollbackAwarenessesForRemovedTurns
} from '../../../pipeline/debate/awareness.js';

const basePersona = (over: Partial<Persona> = {}): Persona => ({
	id: 'p1',
	topicId: 't1',
	name: '田中',
	age: 40,
	occupation: '会社員',
	stakeholderRole: '市民',
	specificRole: '市民',
	background: '',
	interests: '',
	nationality: '',
	engagementLevel: 'medium',
	llmType: 'claude',
	approved: true,
	sortOrder: 0,
	...over
});

const reception: AwarenessEvent = {
	kind: 'reception',
	content: '一理あると受け止めた',
	sourcePersonaId: 'p2'
};

beforeEach(() => {
	holder.mock = createFirestoreMock();
	holder.nextId = 0;
});

describe('getInitialBelief', () => {
	it('beliefs[0] の content を返す', () => {
		const persona = basePersona({
			beliefs: [{ id: 'b0', version: 0, content: '初期信念', createdAt: 'TS' as never }]
		});
		expect(getInitialBelief(persona)).toBe('初期信念');
	});

	it('beliefs が無ければ空文字を返す', () => {
		expect(getInitialBelief(basePersona())).toBe('');
		expect(getInitialBelief(basePersona({ beliefs: [] }))).toBe('');
	});
});

describe('appendAwareness', () => {
	it('Firestore の awarenesses へ arrayUnion で1件追記する（id/createdAt/triggeredByTurnId 付与）', async () => {
		const persona = basePersona();
		await appendAwareness({ topicId: 't1', persona, turnId: 'turn10', awareness: reception });

		const doc = holder.mock!.store.get('topics/t1/personas/p1');
		expect(doc?.awarenesses).toEqual([
			{
				id: 'aw-0',
				kind: 'reception',
				content: '一理あると受け止めた',
				sourcePersonaId: 'p2',
				triggeredByTurnId: 'turn10',
				createdAt: 'TS'
			}
		]);
	});

	it('渡した persona の in-memory awarenesses も同一参照で更新する', async () => {
		const persona = basePersona();
		const before = persona.awarenesses;
		await appendAwareness({ topicId: 't1', persona, turnId: 'turn10', awareness: reception });

		expect(persona.awarenesses).toHaveLength(1);
		expect(persona.awarenesses?.[0]).toMatchObject({
			id: 'aw-0',
			triggeredByTurnId: 'turn10',
			content: '一理あると受け止めた'
		});
		// 既存配列があれば同一参照を維持する
		expect(before).toBeUndefined();
	});

	it('既存の awarenesses 配列がある場合は同一参照へ push する', async () => {
		const persona = basePersona({
			awarenesses: [
				{
					id: 'aw-existing',
					kind: 'self',
					content: '既存',
					sourcePersonaId: null,
					triggeredByTurnId: 'turn1',
					createdAt: 'TS' as never
				}
			]
		});
		const ref = persona.awarenesses;
		await appendAwareness({ topicId: 't1', persona, turnId: 'turn10', awareness: reception });

		expect(persona.awarenesses).toBe(ref);
		expect(persona.awarenesses).toHaveLength(2);
	});
});

describe('rollbackAwarenessesForRemovedTurns', () => {
	it('破棄ターンに紐づく awareness のみ巻き戻し、他は残す', async () => {
		holder.mock!.store.set('topics/t1/personas/p1', {
			awarenesses: [
				{ id: 'a1', triggeredByTurnId: 'keep', content: '残す' },
				{ id: 'a2', triggeredByTurnId: 'drop', content: '消す' }
			]
		});
		holder.mock!.store.set('topics/t1/personas/p2', {
			awarenesses: [{ id: 'a3', triggeredByTurnId: 'keep', content: '残す2' }]
		});

		await rollbackAwarenessesForRemovedTurns('t1', new Set(['drop']));

		expect(holder.mock!.store.get('topics/t1/personas/p1')?.awarenesses).toEqual([
			{ id: 'a1', triggeredByTurnId: 'keep', content: '残す' }
		]);
		// 変化のないペルソナはそのまま
		expect(holder.mock!.store.get('topics/t1/personas/p2')?.awarenesses).toEqual([
			{ id: 'a3', triggeredByTurnId: 'keep', content: '残す2' }
		]);
	});
});
