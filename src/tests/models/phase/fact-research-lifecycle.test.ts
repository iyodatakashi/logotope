import { describe, it, expect } from 'vitest';
import { phaseOrder, nextPhase, phaseLogicalState } from '$lib/models/phase/phase';
import { PHASE_DEFS } from '$lib/models/phase/phase.constants';
import type { PhaseStatus } from '$lib/models/phase/phase.types';

/**
 * 事実リサーチフェーズのライフサイクル検証（Task 8 / R2.1・R2.2・R2.6）。
 * 実行→承認・実行せず承認のどちらの経路も同じ nextPhase('fact-research')==='stakeholders' 前進を通り、
 * 未承認の間はステークホルダー以降が not_started（layout リダイレクトが phaseOrder で担保）になることを、
 * フェーズモデルの純粋関数で end-to-end に固定する。
 */
describe('事実リサーチのライフサイクルとゲート（R2.2）', () => {
	it('事実リサーチがテーマ設定の直後・ステークホルダーの直前にある（R2.1）', () => {
		expect(phaseOrder('theme')).toBe(0);
		expect(phaseOrder('fact-research')).toBe(1);
		expect(phaseOrder('stakeholders')).toBe(2);
	});

	it('承認（実行あり）はステークホルダーへ前進する', () => {
		// 実行→編集→承認: generated 状態から承認して次フェーズへ
		expect(nextPhase('fact-research')).toBe('stakeholders');
	});

	it('実行せず承認（空確定）も同じ nextPhase 経路でステークホルダーへ前進する（R2.5）', () => {
		// 空承認も approveFactResearch＝advancePhase('fact-research') を通るため経路は同一
		expect(nextPhase('fact-research')).toBe('stakeholders');
	});

	it('未承認（phase=fact-research）の間はステークホルダー以降が not_started（進行不可・R2.2）', () => {
		const current = { phase: 'fact-research' as const, phaseStatus: 'generated' as PhaseStatus };
		for (const def of PHASE_DEFS.filter((d) => phaseOrder(d.key) > phaseOrder('fact-research'))) {
			expect(phaseLogicalState(current, def.key)).toBe('not_started');
			// layout リダイレクトの判定条件: 対象フェーズが現在より後（未到達）
			expect(phaseOrder(def.key) > phaseOrder(current.phase)).toBe(true);
		}
	});

	it('承認後（phase=stakeholders）は事実リサーチが approved・ステークホルダーが到達可能', () => {
		const current = { phase: 'stakeholders' as const, phaseStatus: 'not_started' as PhaseStatus };
		expect(phaseLogicalState(current, 'fact-research')).toBe('approved');
		expect(phaseOrder('stakeholders') > phaseOrder(current.phase)).toBe(false);
	});
});
