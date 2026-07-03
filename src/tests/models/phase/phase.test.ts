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
	'fact-research',
	'stakeholders',
	'personas',
	'interviews',
	'chapters',
	'debate',
	'editing'
] as const;

// PhaseSlug の型網羅チェック: 値が増減すると Record リテラルがコンパイルエラーになる
const PHASE_SLUG_EXHAUSTIVE: Record<PhaseSlug, true> = {
	'fact-research': true,
	stakeholders: true,
	personas: true,
	interviews: true,
	chapters: true,
	debate: true,
	editing: true
};

describe('PHASE_DEFS', () => {
	it('7フェーズが正準リスト順で定義されている', () => {
		expect(PHASE_DEFS.map((d) => d.key)).toEqual([
			'fact-research',
			'stakeholders',
			'personas',
			'interviews',
			'chapters',
			'debate',
			'editing'
		]);
	});

	it('keyが一意である', () => {
		const keys = PHASE_DEFS.map((d) => d.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('全フェーズに表示名がある', () => {
		for (const def of PHASE_DEFS) {
			expect(def.label.length).toBeGreaterThan(0);
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

	it('定義配列の順序と各状態別ラベル文言を現行値のスナップショットとしてリテラル固定する', () => {
		expect(PHASE_DEFS).toEqual([
			{
				key: 'fact-research',
				label: '事実リサーチ',
				statusLabels: {
					not_started: '未着手',
					running: 'リサーチ中',
					generated: 'リサーチ完了',
					stopped: 'リサーチ停止'
				}
			},
			{
				key: 'stakeholders',
				label: 'ステークホルダー調査',
				statusLabels: {
					not_started: '未着手',
					running: '調査中',
					generated: '調査完了',
					stopped: '調査停止'
				}
			},
			{
				key: 'personas',
				label: 'ペルソナ生成',
				statusLabels: {
					not_started: '調査承認済み',
					running: 'ペルソナ生成中',
					generated: 'ペルソナ生成完了',
					stopped: 'ペルソナ生成停止'
				}
			},
			{
				key: 'interviews',
				label: '取材',
				statusLabels: {
					not_started: 'ペルソナ承認済み',
					running: '取材中',
					generated: '取材完了',
					stopped: '取材停止'
				}
			},
			{
				key: 'chapters',
				label: '章立て',
				statusLabels: {
					not_started: '取材承認済み',
					running: '章立て生成中',
					generated: '章立て準備中',
					stopped: '章立て生成停止'
				}
			},
			{
				key: 'debate',
				label: '討論',
				statusLabels: {
					not_started: '章立て完了',
					running: '討論中',
					generated: '討論完了',
					stopped: '討論停止'
				}
			},
			{
				key: 'editing',
				label: '編集',
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

describe('phaseLogicalState 数値ケースの 1:1 変換同値テーブル', () => {
	// 番号→slug は旧 6 フェーズ順に固定（1→stakeholders … 6→editing）。
	// リファクタ前 phase.test.ts の数値アサーションを 1:1 変換し、論理状態が現行と完全一致することを検証する。
	// fact-research 挿入で正準リスト先頭がずれるため、この表専用の固定配列を用いる。
	const NUMBERED_PHASES = [
		'stakeholders',
		'personas',
		'interviews',
		'chapters',
		'debate',
		'editing'
	] as const;
	const slugOf = (n: number): PhaseSlug => NUMBERED_PHASES[n - 1];
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
		expect(phaseOrder('fact-research')).toBe(0);
		expect(phaseOrder('stakeholders')).toBe(1);
		expect(phaseOrder('interviews')).toBe(3);
		expect(phaseOrder('editing')).toBe(6);
	});

	it('nextPhase は次の slug を返し、最終フェーズでは null', () => {
		expect(nextPhase('fact-research')).toBe('stakeholders');
		expect(nextPhase('stakeholders')).toBe('personas');
		expect(nextPhase('chapters')).toBe('debate');
		expect(nextPhase('debate')).toBe('editing');
		expect(nextPhase('editing')).toBeNull();
	});

	it('isLastPhase は最終フェーズのみ true', () => {
		expect(isLastPhase('fact-research')).toBe(false);
		expect(isLastPhase('stakeholders')).toBe(false);
		expect(isLastPhase('debate')).toBe(false);
		expect(isLastPhase('editing')).toBe(true);
	});
});

describe('phasePath', () => {
	it('フェーズURLを /admin/topics/{id}/{slug} 形式で生成する', () => {
		expect(phasePath('t1', 'fact-research')).toBe('/admin/topics/t1/fact-research');
		expect(phasePath('t1', 'stakeholders')).toBe('/admin/topics/t1/stakeholders');
		expect(phasePath('t1', 'personas')).toBe('/admin/topics/t1/personas');
		expect(phasePath('t1', 'interviews')).toBe('/admin/topics/t1/interviews');
		expect(phasePath('t1', 'chapters')).toBe('/admin/topics/t1/chapters');
		expect(phasePath('t1', 'debate')).toBe('/admin/topics/t1/debate');
		expect(phasePath('t1', 'editing')).toBe('/admin/topics/t1/editing');
	});
});

describe('phaseLogicalState', () => {
	it('対象フェーズが現在より前なら approved', () => {
		expect(phaseLogicalState({ phase: 'interviews', phaseStatus: 'running' }, 'stakeholders')).toBe(
			'approved'
		);
		expect(phaseLogicalState({ phase: 'debate', phaseStatus: 'generated' }, 'chapters')).toBe(
			'approved'
		);
	});

	it('対象フェーズが現在より後なら not_started', () => {
		expect(phaseLogicalState({ phase: 'personas', phaseStatus: 'generated' }, 'interviews')).toBe(
			'not_started'
		);
		expect(phaseLogicalState({ phase: 'stakeholders', phaseStatus: 'running' }, 'debate')).toBe(
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
		expect(phaseLogicalState({ phase: 'debate', phaseStatus: 'running' }, 'debate')).toBe(
			'running'
		);
		expect(phaseLogicalState({ phase: 'debate', phaseStatus: 'stopped' }, 'debate')).toBe(
			'stopped'
		);
		expect(phaseLogicalState({ phase: 'interviews', phaseStatus: 'stopped' }, 'interviews')).toBe(
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
		['fact-research', 'not_started', '未着手', 'pending'],
		['fact-research', 'running', 'リサーチ中', 'running'],
		['fact-research', 'generated', 'リサーチ完了', 'ready'],
		['fact-research', 'stopped', 'リサーチ停止', 'stopped'],
		['stakeholders', 'not_started', '未着手', 'pending'],
		['stakeholders', 'running', '調査中', 'running'],
		['stakeholders', 'stopped', '調査停止', 'stopped'],
		['personas', 'running', 'ペルソナ生成中', 'running'],
		['interviews', 'running', '取材中', 'running'],
		['interviews', 'stopped', '取材停止', 'stopped'],
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
