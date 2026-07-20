import { describe, it, expect } from 'vitest';
import { buildPrompt, STYLE_FIXED_CLAUSES, REFERENCE_IMAGES } from '../prompt-builder';
import { resolveVariation } from '../variation-spec';

const spec = resolveVariation('thirties_forties', 'female', '01');

describe('規範プロンプトの組み立て（Req 3.1）', () => {
	it('同一 spec から同一プロンプトが再現的に得られる（決定的）', () => {
		expect(buildPrompt(spec)).toEqual(buildPrompt(spec));
	});

	it('スタイル固定文（無地白背景・顔なし・黒基調・バストアップ・単純化）を常に含む', () => {
		const { prompt } = buildPrompt(spec);
		for (const clause of STYLE_FIXED_CLAUSES) {
			expect(prompt).toContain(clause);
		}
	});

	it('各軸の値（髪型・服装）を明示的に埋め込む', () => {
		const { prompt } = buildPrompt(spec);
		expect(prompt).toContain(spec.hairStyle);
		expect(prompt).toContain(spec.outfit);
	});

	it('軸の値を変えるとプロンプトが変わる（AI 裁量任せでなく指定で出し分け・Req 2.2）', () => {
		const other = resolveVariation('thirties_forties', 'female', '02');
		expect(buildPrompt(spec).prompt).not.toBe(buildPrompt(other).prompt);
	});

	it('メガネ有無が正しく反映される', () => {
		const withGlasses = { ...spec, glasses: true };
		const withoutGlasses = { ...spec, glasses: false };
		expect(buildPrompt(withGlasses).prompt).toContain('メガネ: あり');
		expect(buildPrompt(withoutGlasses).prompt).toContain('メガネ: なし');
	});

	it('参照画像はスタイルアンカーとして最大3枚・空でなく安定', () => {
		const { referenceImages } = buildPrompt(spec);
		expect(referenceImages.length).toBeGreaterThan(0);
		expect(referenceImages.length).toBeLessThanOrEqual(3);
		expect(referenceImages).toEqual(REFERENCE_IMAGES);
	});
});
