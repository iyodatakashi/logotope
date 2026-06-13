import { describe, it, expect } from 'vitest';
import {
	PHASE_DEFS,
	statusToPhase,
	phasePath,
	phaseLogicalState,
	deriveLegacyPhaseState,
	phaseDisplayLabel,
	resolveCurrentPhase
} from './phase.js';
import type { Phase, PhaseStatus } from './phase.js';
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

	it('現在フェーズが not_started / generated ならそのまま返す', () => {
		expect(phaseLogicalState({ phase: 2, phaseStatus: 'not_started' }, 2)).toBe('not_started');
		expect(phaseLogicalState({ phase: 2, phaseStatus: 'generated' }, 2)).toBe('generated');
	});

	it('running でヒント未指定なら再調整せず running を返す', () => {
		expect(phaseLogicalState({ phase: 2, phaseStatus: 'running' }, 2)).toBe('running');
		expect(phaseLogicalState({ phase: 5, phaseStatus: 'running' }, 5)).toBe('running');
	});

	it('フェーズ5 running + session cancelled（未完了）は stopped に再調整', () => {
		expect(
			phaseLogicalState({ phase: 5, phaseStatus: 'running' }, 5, { sessionStatus: 'cancelled' })
		).toBe('stopped');
	});

	it('フェーズ5 running + session completed は generated に再調整', () => {
		expect(
			phaseLogicalState({ phase: 5, phaseStatus: 'running' }, 5, { sessionStatus: 'completed' })
		).toBe('generated');
		expect(
			phaseLogicalState({ phase: 5, phaseStatus: 'running' }, 5, { debateComplete: true })
		).toBe('generated');
	});

	it('フェーズ5 running + session debating は running のまま', () => {
		expect(
			phaseLogicalState({ phase: 5, phaseStatus: 'running' }, 5, { sessionStatus: 'debating' })
		).toBe('running');
	});

	it('クライアント権威フェーズ(1〜4)の running は inFlight でなければ not_started に再調整', () => {
		expect(
			phaseLogicalState({ phase: 2, phaseStatus: 'running' }, 2, { clientPhaseInFlight: false })
		).toBe('not_started');
		expect(phaseLogicalState({ phase: 3, phaseStatus: 'running' }, 3, {})).toBe('not_started');
	});

	it('クライアント権威フェーズの running は inFlight 中なら running のまま', () => {
		expect(
			phaseLogicalState({ phase: 2, phaseStatus: 'running' }, 2, { clientPhaseInFlight: true })
		).toBe('running');
	});
});

describe('deriveLegacyPhaseState', () => {
	const cases: [DebateStatus, Phase, PhaseStatus][] = [
		['pending', 1, 'not_started'],
		['surveying', 1, 'running'],
		['generating_personas', 2, 'running'],
		['interviewing', 3, 'running'],
		['chapters_ready', 4, 'generated'],
		['chapters_approved', 5, 'not_started'],
		['debating', 5, 'running'],
		['cancelled', 5, 'running'],
		['completed', 5, 'generated'],
		['published', 5, 'generated']
	];

	it.each(cases)('旧status %s → (%i, %s)', (status, phase, phaseStatus) => {
		expect(deriveLegacyPhaseState(status)).toEqual({ phase, phaseStatus });
	});

	it('未知のstatusはヒントなしで (1, not_started) にフォールバック', () => {
		expect(deriveLegacyPhaseState('unknown')).toEqual({ phase: 1, phaseStatus: 'not_started' });
	});

	it('未知のstatusでもヒントから到達済みフェーズを再構築する', () => {
		expect(
			deriveLegacyPhaseState('unknown', {
				hasStakeholders: true,
				stakeholdersApproved: true,
				hasPersonas: true,
				allInterviewsDone: true,
				hasChapters: true,
				sessionStatus: 'completed'
			})
		).toEqual({ phase: 5, phaseStatus: 'generated' });
	});
});

describe('resolveCurrentPhase', () => {
	it('topic.phase が設定されていればそれを使う（新モデル優先）', () => {
		expect(resolveCurrentPhase({ phase: 3 as Phase, status: 'pending' as DebateStatus })).toBe(3);
		expect(resolveCurrentPhase({ phase: 5 as Phase, status: 'surveying' as DebateStatus })).toBe(5);
	});

	it('topic.phase が未設定なら statusToPhase にフォールバック（旧モデル互換）', () => {
		expect(resolveCurrentPhase({ status: 'interviewing' as DebateStatus })).toBe(3);
		expect(resolveCurrentPhase({ status: 'completed' as DebateStatus })).toBe(5);
	});

	it('topic.phase が undefined なら statusToPhase にフォールバック', () => {
		expect(resolveCurrentPhase({ phase: undefined, status: 'chapters_ready' as DebateStatus })).toBe(4);
	});
});

describe('phaseDisplayLabel', () => {
	const cases: [Phase, PhaseStatus, string, string][] = [
		[1, 'not_started', '未着手', 'pending'],
		[1, 'running', '調査中', 'running'],
		[2, 'running', 'ペルソナ生成中', 'running'],
		[3, 'running', '取材中', 'running'],
		[4, 'generated', '章立て準備中', 'ready'],
		[5, 'not_started', '章立て完了', 'pending'],
		[5, 'running', '討論中', 'running'],
		[5, 'generated', '討論完了', 'completed']
	];

	it.each(cases)('(%i, %s) → %s / %s', (phase, phaseStatus, label, styleKey) => {
		expect(phaseDisplayLabel({ phase, phaseStatus })).toEqual({ label, styleKey });
	});
});
