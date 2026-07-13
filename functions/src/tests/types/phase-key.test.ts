import { describe, it, expect } from 'vitest';
import type { PhaseKey } from '../../types/topic.types.js';
import type { GeneratePhase } from '../../utils/topic-phase.js';

// 正準 slug リスト（順序込み）— FE PHASE_DEFS と一致させる唯一の基準。
const CANONICAL_PHASE_KEYS = [
	'theme',
	'fact-research',
	'stakeholders',
	'personas',
	'interviews',
	'chapters',
	'debate',
	'editing'
] as const;

// 型網羅チェック: PhaseKey / GeneratePhase の値が増減すると Record リテラルがコンパイルエラーになる。
const PHASE_KEY_EXHAUSTIVE: Record<PhaseKey, true> = {
	theme: true,
	'fact-research': true,
	stakeholders: true,
	personas: true,
	interviews: true,
	chapters: true,
	debate: true,
	editing: true
};

const GENERATE_PHASE_EXHAUSTIVE: Record<GeneratePhase, true> = {
	'fact-research': true,
	stakeholders: true,
	personas: true,
	interviews: true,
	chapters: true
};

describe('BE PhaseKey slug 集合の self-check', () => {
	it('PhaseKey の全値が正準リストと一致する（型網羅）', () => {
		expect(Object.keys(PHASE_KEY_EXHAUSTIVE).sort()).toEqual([...CANONICAL_PHASE_KEYS].sort());
	});

	it('正準リストは順序込みで固定されている', () => {
		expect([...CANONICAL_PHASE_KEYS]).toEqual([
			'theme',
			'fact-research',
			'stakeholders',
			'personas',
			'interviews',
			'chapters',
			'debate',
			'editing'
		]);
	});

	it('GeneratePhase は生成確定を持つ部分集合（theme/debate/editing を含まない）', () => {
		const generateKeys = Object.keys(GENERATE_PHASE_EXHAUSTIVE);
		expect(generateKeys.sort()).toEqual(
			['fact-research', 'stakeholders', 'personas', 'interviews', 'chapters'].sort()
		);
		expect(generateKeys).not.toContain('theme');
		expect(generateKeys).not.toContain('debate');
		expect(generateKeys).not.toContain('editing');
	});
});
