import { describe, it, expect } from 'vitest';
import type { PhaseSlug } from '../../types/phase.types.js';
import type { GeneratePhase } from '../../utils/topic-phase.js';

// 正準 slug リスト（順序込み）— FE PHASE_DEFS と一致させる唯一の基準。
const CANONICAL_PHASE_KEYS = [
	'theme',
	'fact-research',
	'personas',
	'chapters',
	'debate',
	'editing',
	'publish'
] as const;

// 型網羅チェック: PhaseSlug / GeneratePhase の値が増減すると Record リテラルがコンパイルエラーになる。
const PHASE_KEY_EXHAUSTIVE: Record<PhaseSlug, true> = {
	theme: true,
	'fact-research': true,
	personas: true,
	chapters: true,
	debate: true,
	editing: true,
	publish: true
};

const GENERATE_PHASE_EXHAUSTIVE: Record<GeneratePhase, true> = {
	'fact-research': true,
	personas: true,
	chapters: true
};

describe('BE PhaseSlug slug 集合の self-check', () => {
	it('PhaseSlug の全値が正準リストと一致する（型網羅）', () => {
		expect(Object.keys(PHASE_KEY_EXHAUSTIVE).sort()).toEqual([...CANONICAL_PHASE_KEYS].sort());
	});

	it('正準リストは順序込みで固定されている', () => {
		expect([...CANONICAL_PHASE_KEYS]).toEqual([
			'theme',
			'fact-research',
			'personas',
			'chapters',
			'debate',
			'editing',
			'publish'
		]);
	});

	it('正準リストに stakeholders / interviews を含まない', () => {
		expect([...CANONICAL_PHASE_KEYS]).not.toContain('stakeholders');
		expect([...CANONICAL_PHASE_KEYS]).not.toContain('interviews');
	});

	it('GeneratePhase は生成確定を持つ部分集合（theme/debate/editing を含まない）', () => {
		const generateKeys = Object.keys(GENERATE_PHASE_EXHAUSTIVE);
		expect(generateKeys.sort()).toEqual(['fact-research', 'personas', 'chapters'].sort());
		expect(generateKeys).not.toContain('theme');
		expect(generateKeys).not.toContain('debate');
		expect(generateKeys).not.toContain('editing');
	});
});
