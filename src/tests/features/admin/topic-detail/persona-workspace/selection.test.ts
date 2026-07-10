import { describe, it, expect } from 'vitest';
import {
	matchPersona,
	reconcileSelection
} from '$lib/features/admin/topic-detail/persona-workspace/selection';
import type { Stakeholder } from '$lib/models/stakeholder/stakeholder.types';
import type { Persona } from '$lib/models/persona/persona.types';

const stakeholder = (over: Partial<Stakeholder> = {}): Stakeholder => ({
	id: 'sid-a',
	role: '医師',
	reason: '',
	mainInterests: [],
	minorityLevel: 'low',
	...over
});

const persona = (over: Partial<Persona> = {}): Persona =>
	({
		id: 'p1',
		topicId: 't1',
		name: '太郎',
		age: 40,
		occupation: '',
		stakeholderRole: '医師',
		specificRole: '',
		background: '',
		interests: '',
		approved: false,
		sortOrder: 0,
		beliefs: [],
		...over
	}) as Persona;

describe('matchPersona', () => {
	it('由来キー（stakeholderId）で対応ペルソナを解決する', () => {
		const s = stakeholder({ id: 'sid-a' });
		const target = persona({ id: 'p1', stakeholderId: 'sid-a' });
		const other = persona({ id: 'p2', stakeholderId: 'sid-b', stakeholderRole: '医師' });
		expect(matchPersona(s, [other, target])?.id).toBe('p1');
	});

	it('対応ペルソナが無ければ undefined', () => {
		const s = stakeholder({ id: 'sid-z', role: '記者' });
		expect(matchPersona(s, [persona({ stakeholderId: 'sid-a' })])).toBeUndefined();
	});
});

describe('reconcileSelection', () => {
	it('新規に現れた id のみ既定 ON でシードする', () => {
		const result = reconcileSelection({
			stakeholders: [stakeholder({ id: 'a' }), stakeholder({ id: 'b' })],
			selectedIds: new Set(),
			seededIds: new Set()
		});
		expect(result.changed).toBe(true);
		expect([...result.selectedIds].sort()).toEqual(['a', 'b']);
		expect([...result.seededIds].sort()).toEqual(['a', 'b']);
	});

	it('既存のユーザ選択（解除含む）を保持し、新規のみ追加する', () => {
		// a は既にシード済みでユーザが解除（selected から外れている）。b が新規に出現。
		const result = reconcileSelection({
			stakeholders: [stakeholder({ id: 'a' }), stakeholder({ id: 'b' })],
			selectedIds: new Set(), // a は解除済み
			seededIds: new Set(['a'])
		});
		expect([...result.selectedIds]).toEqual(['b']); // a は再シードされない
	});

	it('シード済みで変化が無ければ changed=false', () => {
		const result = reconcileSelection({
			stakeholders: [stakeholder({ id: 'a' })],
			selectedIds: new Set(['a']),
			seededIds: new Set(['a'])
		});
		expect(result.changed).toBe(false);
	});

	it('ステークホルダー総入れ替え（新 id 集合）では新集合が全 ON になる', () => {
		// 旧 a,b をシード済み。再調査で c,d に総入れ替え。
		const result = reconcileSelection({
			stakeholders: [stakeholder({ id: 'c' }), stakeholder({ id: 'd' })],
			selectedIds: new Set(), // 旧選択は実在しない id のみ
			seededIds: new Set(['a', 'b'])
		});
		expect([...result.selectedIds].sort()).toEqual(['c', 'd']);
	});
});
