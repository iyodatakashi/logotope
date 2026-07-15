import { describe, it, expect } from 'vitest';
import {
	phasePath,
	phaseOrder,
	nextPhase,
	isLastPhase,
	phaseLogicalState,
	phaseDisplayLabel
} from '$lib/models/phase/phase';
import { PHASE_DEFS } from '$lib/models/phase/phase.constants';
import type { PhaseSlug, PhaseStatus, PhaseLogicalState } from '$lib/models/phase/phase.types';

// 正準 slug リスト（順序込み）— FE/BE 両側の唯一の基準。
const CANONICAL_PHASE_KEYS = [
	'theme',
	'fact-research',
	'personas',
	'chapters',
	'debate',
	'editing'
] as const;

// PhaseSlug の型網羅チェック: 値が増減すると Record リテラルがコンパイルエラーになる
const PHASE_SLUG_EXHAUSTIVE: Record<PhaseSlug, true> = {
	theme: true,
	'fact-research': true,
	personas: true,
	chapters: true,
	debate: true,
	editing: true
};

describe('PHASE_DEFS', () => {
	it('6フェーズが正準リスト順で定義されている', () => {
		expect(PHASE_DEFS.map((d) => d.key)).toEqual([
			'theme',
			'fact-research',
			'personas',
			'chapters',
			'debate',
			'editing'
		]);
	});

	it('keyが一意である', () => {
		const keys = PHASE_DEFS.map((d) => d.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('全フェーズに状態別ラベルが揃っている', () => {
		for (const def of PHASE_DEFS) {
			for (const status of ['not_started', 'running', 'generated', 'stopped'] as const) {
				expect(def.statusLabels[status].length).toBeGreaterThan(0);
			}
		}
	});
});

describe('slug 集合・順序・ラベルの self-check（挙動不変の担保）', () => {
	it('PHASE_DEFS の key 配列が正準リストと順序込みで一致する', () => {
		expect(PHASE_DEFS.map((d) => d.key)).toEqual([...CANONICAL_PHASE_KEYS]);
	});

	it('PhaseSlug の全値が正準リストと一致する（型網羅）', () => {
		expect(Object.keys(PHASE_SLUG_EXHAUSTIVE).sort()).toEqual([...CANONICAL_PHASE_KEYS].sort());
	});

	it('廃止された stakeholders / interviews を含まない', () => {
		expect(PHASE_DEFS.map((d) => d.key)).not.toContain('stakeholders');
		expect(PHASE_DEFS.map((d) => d.key)).not.toContain('interviews');
	});

	it('定義配列の順序と各状態別ラベル文言をスナップショットとしてリテラル固定する', () => {
		expect(PHASE_DEFS).toEqual([
			{
				key: 'theme',
				statusLabels: {
					not_started: 'テーマ設定中',
					running: 'テーマ設定中',
					generated: 'テーマ設定中',
					stopped: 'テーマ設定中'
				}
			},
			{
				key: 'fact-research',
				statusLabels: {
					not_started: '未着手',
					running: 'リサーチ中',
					generated: 'リサーチ完了',
					stopped: 'リサーチ停止'
				}
			},
			{
				key: 'personas',
				statusLabels: {
					not_started: '未着手',
					running: 'ペルソナ生成中',
					generated: 'ペルソナ生成完了',
					stopped: 'ペルソナ生成停止'
				}
			},
			{
				key: 'chapters',
				statusLabels: {
					not_started: '取材承認済み',
					running: '章立て生成中',
					generated: '章立て準備中',
					stopped: '章立て生成停止'
				}
			},
			{
				key: 'debate',
				statusLabels: {
					not_started: '章立て完了',
					running: '討論中',
					generated: '討論完了',
					stopped: '討論停止'
				}
			},
			{
				key: 'editing',
				statusLabels: {
					not_started: '討論完了',
					running: '編集中',
					generated: '編集完了',
					stopped: '編集停止'
				}
			}
		]);
	});
});

describe('phaseLogicalState 順序ケースの同値テーブル', () => {
	// 番号→slug は正準リスト順に固定（1→theme … 6→editing）。
	// 論理状態は順序関係（target<current→approved / target>current→not_started / 一致→phaseStatus）のみで決まる。
	const slugOf = (n: number): PhaseSlug => CANONICAL_PHASE_KEYS[n - 1];
	const cases: [number, PhaseStatus, number, PhaseLogicalState][] = [
		[3, 'running', 1, 'approved'],
		[5, 'generated', 4, 'approved'],
		[2, 'generated', 3, 'not_started'],
		[1, 'running', 5, 'not_started'],
		[2, 'not_started', 2, 'not_started'],
		[2, 'running', 2, 'running'],
		[2, 'generated', 2, 'generated'],
		[2, 'stopped', 2, 'stopped'],
		[5, 'running', 5, 'running'],
		[5, 'stopped', 5, 'stopped'],
		[3, 'stopped', 3, 'stopped'],
		[6, 'not_started', 6, 'not_started'],
		[6, 'running', 6, 'running'],
		[6, 'generated', 6, 'generated'],
		[6, 'stopped', 6, 'stopped'],
		[5, 'generated', 6, 'not_started']
	];

	it.each(cases)(
		'phase=%i status=%s target=%i → 現行と同値',
		(phaseNum, phaseStatus, targetNum, expected) => {
			expect(phaseLogicalState({ phase: slugOf(phaseNum), phaseStatus }, slugOf(targetNum))).toBe(
				expected
			);
		}
	);
});

describe('phaseOrder / nextPhase / isLastPhase', () => {
	it('phaseOrder は配列位置を返す', () => {
		expect(phaseOrder('theme')).toBe(0);
		expect(phaseOrder('fact-research')).toBe(1);
		expect(phaseOrder('personas')).toBe(2);
		expect(phaseOrder('chapters')).toBe(3);
		expect(phaseOrder('editing')).toBe(5);
	});

	it('nextPhase は次の slug を返し、最終フェーズでは null', () => {
		expect(nextPhase('theme')).toBe('fact-research');
		expect(nextPhase('fact-research')).toBe('personas');
		expect(nextPhase('personas')).toBe('chapters');
		expect(nextPhase('chapters')).toBe('debate');
		expect(nextPhase('debate')).toBe('editing');
		expect(nextPhase('editing')).toBeNull();
	});

	it('isLastPhase は最終フェーズのみ true', () => {
		expect(isLastPhase('theme')).toBe(false);
		expect(isLastPhase('fact-research')).toBe(false);
		expect(isLastPhase('personas')).toBe(false);
		expect(isLastPhase('debate')).toBe(false);
		expect(isLastPhase('editing')).toBe(true);
	});
});

describe('phasePath', () => {
	it('フェーズURLを /admin/topics/{id}/{slug} 形式で生成する', () => {
		expect(phasePath('t1', 'fact-research')).toBe('/admin/topics/t1/fact-research');
		expect(phasePath('t1', 'personas')).toBe('/admin/topics/t1/personas');
		expect(phasePath('t1', 'chapters')).toBe('/admin/topics/t1/chapters');
		expect(phasePath('t1', 'debate')).toBe('/admin/topics/t1/debate');
		expect(phasePath('t1', 'editing')).toBe('/admin/topics/t1/editing');
	});
});

describe('phaseLogicalState', () => {
	it('対象フェーズが現在より前なら approved', () => {
		expect(phaseLogicalState({ phase: 'chapters', phaseStatus: 'running' }, 'personas')).toBe(
			'approved'
		);
		expect(phaseLogicalState({ phase: 'debate', phaseStatus: 'generated' }, 'chapters')).toBe(
			'approved'
		);
	});

	it('対象フェーズが現在より後なら not_started', () => {
		expect(phaseLogicalState({ phase: 'personas', phaseStatus: 'generated' }, 'chapters')).toBe(
			'not_started'
		);
		expect(phaseLogicalState({ phase: 'personas', phaseStatus: 'running' }, 'debate')).toBe(
			'not_started'
		);
	});

	it('現在フェーズに一致する場合は phaseStatus をそのまま返す（ヒント参照なし）', () => {
		expect(phaseLogicalState({ phase: 'personas', phaseStatus: 'not_started' }, 'personas')).toBe(
			'not_started'
		);
		expect(phaseLogicalState({ phase: 'personas', phaseStatus: 'running' }, 'personas')).toBe(
			'running'
		);
		expect(phaseLogicalState({ phase: 'personas', phaseStatus: 'generated' }, 'personas')).toBe(
			'generated'
		);
		expect(phaseLogicalState({ phase: 'personas', phaseStatus: 'stopped' }, 'personas')).toBe(
			'stopped'
		);
	});

	it('停止は全フェーズで導出できる（討論の running/stopped も同じ規則）', () => {
		expect(phaseLogicalState({ phase: 'debate', phaseStatus: 'running' }, 'debate')).toBe('running');
		expect(phaseLogicalState({ phase: 'debate', phaseStatus: 'stopped' }, 'debate')).toBe('stopped');
		expect(phaseLogicalState({ phase: 'personas', phaseStatus: 'stopped' }, 'personas')).toBe(
			'stopped'
		);
	});

	it('編集フェーズ（editing）の論理状態を導出できる', () => {
		expect(phaseLogicalState({ phase: 'editing', phaseStatus: 'not_started' }, 'editing')).toBe(
			'not_started'
		);
		expect(phaseLogicalState({ phase: 'editing', phaseStatus: 'running' }, 'editing')).toBe(
			'running'
		);
		expect(phaseLogicalState({ phase: 'editing', phaseStatus: 'generated' }, 'editing')).toBe(
			'generated'
		);
		expect(phaseLogicalState({ phase: 'editing', phaseStatus: 'stopped' }, 'editing')).toBe(
			'stopped'
		);
		expect(phaseLogicalState({ phase: 'debate', phaseStatus: 'generated' }, 'editing')).toBe(
			'not_started'
		);
	});
});

describe('phaseDisplayLabel', () => {
	const cases: [PhaseSlug, PhaseStatus, string, string][] = [
		['theme', 'not_started', 'テーマ設定中', 'pending'],
		['fact-research', 'not_started', '未着手', 'pending'],
		['fact-research', 'running', 'リサーチ中', 'running'],
		['fact-research', 'generated', 'リサーチ完了', 'ready'],
		['fact-research', 'stopped', 'リサーチ停止', 'stopped'],
		['personas', 'not_started', '未着手', 'pending'],
		['personas', 'running', 'ペルソナ生成中', 'running'],
		['personas', 'generated', 'ペルソナ生成完了', 'ready'],
		['personas', 'stopped', 'ペルソナ生成停止', 'stopped'],
		['chapters', 'generated', '章立て準備中', 'ready'],
		['debate', 'not_started', '章立て完了', 'pending'],
		['debate', 'running', '討論中', 'running'],
		['debate', 'stopped', '討論停止', 'stopped'],
		['debate', 'generated', '討論完了', 'ready'],
		['editing', 'not_started', '討論完了', 'pending'],
		['editing', 'running', '編集中', 'running'],
		['editing', 'stopped', '編集停止', 'stopped'],
		['editing', 'generated', '編集完了', 'completed']
	];

	it.each(cases)('(%s, %s) → %s / %s', (phase, phaseStatus, label, styleKey) => {
		expect(phaseDisplayLabel({ phase, phaseStatus })).toEqual({ label, styleKey });
	});
});
