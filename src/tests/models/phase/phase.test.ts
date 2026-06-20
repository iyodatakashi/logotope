import { describe, it, expect } from 'vitest';
import { phasePath, phaseLogicalState, phaseDisplayLabel } from '$lib/models/phase/phase';
import { PHASE_DEFS } from '$lib/models/phase/phase.constants';
import type { Phase, PhaseStatus } from '$lib/models/phase/phase.types';

describe('PHASE_DEFS', () => {
	it('5フェーズがphase昇順で定義されている', () => {
		expect(PHASE_DEFS.map((d) => d.phase)).toEqual([1, 2, 3, 4, 5]);
	});

	it('slugが一意である', () => {
		const slugs = PHASE_DEFS.map((d) => d.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it('全フェーズに表示名がある', () => {
		for (const def of PHASE_DEFS) {
			expect(def.label.length).toBeGreaterThan(0);
		}
	});
});

describe('phasePath', () => {
	it('フェーズURLを /admin/topics/{id}/{slug} 形式で生成する', () => {
		expect(phasePath('t1', 1)).toBe('/admin/topics/t1/stakeholders');
		expect(phasePath('t1', 2)).toBe('/admin/topics/t1/personas');
		expect(phasePath('t1', 3)).toBe('/admin/topics/t1/interviews');
		expect(phasePath('t1', 4)).toBe('/admin/topics/t1/chapters');
		expect(phasePath('t1', 5)).toBe('/admin/topics/t1/debate');
	});
});

describe('phaseLogicalState', () => {
	it('対象フェーズが現在より前なら approved', () => {
		expect(phaseLogicalState({ phase: 3, phaseStatus: 'running' }, 1)).toBe('approved');
		expect(phaseLogicalState({ phase: 5, phaseStatus: 'generated' }, 4)).toBe('approved');
	});

	it('対象フェーズが現在より後なら not_started', () => {
		expect(phaseLogicalState({ phase: 2, phaseStatus: 'generated' }, 3)).toBe('not_started');
		expect(phaseLogicalState({ phase: 1, phaseStatus: 'running' }, 5)).toBe('not_started');
	});

	it('現在フェーズに一致する場合は phaseStatus をそのまま返す（ヒント参照なし）', () => {
		expect(phaseLogicalState({ phase: 2, phaseStatus: 'not_started' }, 2)).toBe('not_started');
		expect(phaseLogicalState({ phase: 2, phaseStatus: 'running' }, 2)).toBe('running');
		expect(phaseLogicalState({ phase: 2, phaseStatus: 'generated' }, 2)).toBe('generated');
		expect(phaseLogicalState({ phase: 2, phaseStatus: 'stopped' }, 2)).toBe('stopped');
	});

	it('停止は全フェーズで導出できる（フェーズ5の running/stopped も同じ規則）', () => {
		expect(phaseLogicalState({ phase: 5, phaseStatus: 'running' }, 5)).toBe('running');
		expect(phaseLogicalState({ phase: 5, phaseStatus: 'stopped' }, 5)).toBe('stopped');
		expect(phaseLogicalState({ phase: 3, phaseStatus: 'stopped' }, 3)).toBe('stopped');
	});
});

describe('phaseDisplayLabel', () => {
	const cases: [Phase, PhaseStatus, string, string][] = [
		[1, 'not_started', '未着手', 'pending'],
		[1, 'running', '調査中', 'running'],
		[1, 'stopped', '調査停止', 'stopped'],
		[2, 'running', 'ペルソナ生成中', 'running'],
		[3, 'running', '取材中', 'running'],
		[3, 'stopped', '取材停止', 'stopped'],
		[4, 'generated', '章立て準備中', 'ready'],
		[5, 'not_started', '章立て完了', 'pending'],
		[5, 'running', '討論中', 'running'],
		[5, 'stopped', '討論停止', 'stopped'],
		[5, 'generated', '討論完了', 'completed']
	];

	it.each(cases)('(%i, %s) → %s / %s', (phase, phaseStatus, label, styleKey) => {
		expect(phaseDisplayLabel({ phase, phaseStatus })).toEqual({ label, styleKey });
	});
});
