import { describe, it, expect } from 'vitest';
import { PHASE_DEFS, phasePath, phaseLogicalState, phaseDisplayLabel } from './phase.js';
import type { Phase, PhaseStatus } from './phase.js';

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

describe('PhaseDef 拡張（操作設定）', () => {
	it('全フェーズに生成・再生成ラベルと再生成確認文言がある', () => {
		for (const def of PHASE_DEFS) {
			expect(def.generateLabel.length).toBeGreaterThan(0);
			expect(def.regenerateLabel.length).toBeGreaterThan(0);
			expect(def.regenerateConfirm.title.length).toBeGreaterThan(0);
			expect(def.regenerateConfirm.description.length).toBeGreaterThan(0);
			expect(def.regenerateConfirm.submitLabel.length).toBeGreaterThan(0);
		}
	});

	it('フェーズ1〜4は承認(forwardAction)を持ち、停止・再開を持たない', () => {
		for (const def of PHASE_DEFS.filter((d) => d.phase !== 5)) {
			expect(def.forwardAction).toEqual({ kind: 'approve', label: expect.any(String) });
			expect(def.stoppable).toBeFalsy();
			expect(def.restartable).toBeFalsy();
		}
	});

	it('フェーズ5は承認を持たず、停止・再開が可能', () => {
		const def = PHASE_DEFS.find((d) => d.phase === 5)!;
		expect(def.forwardAction).toBeUndefined();
		expect(def.stoppable).toBe(true);
		expect(def.restartable).toBe(true);
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
