import { describe, it, expect } from 'vitest';
import { toPersona } from '../../../pipeline/personas/personas.js';
import type { PersonaForFirestore } from '../../../types/persona.types.js';

// 移行フォールバック撤去後（task 5.3）の end-state 検証: role を直参照し、旧 specificRole/総称 stakeholderRole へ
// 一切導出しない。role が非移行のペルソナ文書には legacy な specificRole が残り得るため、型を緩めて渡す。
const doc = (over: Record<string, unknown>): PersonaForFirestore =>
	({
		id: 'p1',
		topicId: 't1',
		name: '田中',
		age: 40,
		occupation: '会社員',
		stakeholderRole: '市民',
		stakeholderId: 's1',
		background: '',
		interests: '',
		nationality: '日本',
		engagementLevel: 'high',
		gender: 'male',
		genderPresentation: 'masculine',
		colorKey: 'blue',
		selected: true,
		sortOrder: 0,
		...over
	}) as PersonaForFirestore;

describe('toPersona — role 直参照（移行フォールバック撤去後の end-state・5.3）', () => {
	it('role を直参照し、旧 specificRole・総称 stakeholderRole があっても無視する', () => {
		expect(
			toPersona('p1', doc({ role: '救急医', specificRole: '旧値', stakeholderRole: '医療' })).role
		).toBe('救急医');
	});

	it('role 欠落時に旧 specificRole・総称 stakeholderRole へフォールバックしない（導出の恒久排除）', () => {
		expect(toPersona('p1', doc({ specificRole: '医師' })).role).toBeUndefined();
	});

	it('interview オブジェクトは interviewRecord へ平坦化する', () => {
		const persona = toPersona('p1', doc({ role: 'x', interview: { status: 'completed', interviewRecord: '記録' } }));
		expect(persona.interviewRecord).toBe('記録');
	});
});
