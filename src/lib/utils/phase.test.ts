import { describe, it, expect } from 'vitest';
import { PHASE_DEFS, statusToPhase, phasePath } from './phase.js';
import type { DebateStatus } from '$lib/models/topic/topic.types.js';

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

describe('statusToPhase', () => {
	const cases: [DebateStatus, number][] = [
		['pending', 1],
		['surveying', 1],
		['generating_personas', 2],
		['interviewing', 3],
		['chapters_ready', 4],
		['cancelled', 4],
		['chapters_approved', 5],
		['debating', 5],
		['completed', 5],
		['published', 5],
	];

	it.each(cases)('%s → Phase %i', (status, phase) => {
		expect(statusToPhase(status)).toBe(phase);
	});

	it('未知のstatusはPhase 1にフォールバックする', () => {
		expect(statusToPhase('unknown_status' as DebateStatus)).toBe(1);
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
