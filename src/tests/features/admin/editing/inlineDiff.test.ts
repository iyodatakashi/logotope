import { describe, it, expect } from 'vitest';
import { computeInlineDiff } from '$lib/features/admin/topic-detail/editing/inlineDiff';

describe('computeInlineDiff', () => {
	it('変更が無ければ全体を equal セグメントとして返す', () => {
		const segments = computeInlineDiff('同じ文章です', '同じ文章です');
		expect(segments).toEqual([{ type: 'equal', text: '同じ文章です' }]);
	});

	it('削除された箇所を delete セグメントにする', () => {
		const segments = computeInlineDiff('まあ、その、私は賛成です', '私は賛成です');
		expect(segments.some((s) => s.type === 'delete' && s.text.includes('まあ'))).toBe(true);
		// 残った本文は equal として保持される
		expect(segments.some((s) => s.type === 'equal' && s.text.includes('私は賛成です'))).toBe(true);
		// 挿入は無い
		expect(segments.some((s) => s.type === 'insert')).toBe(false);
	});

	it('追加された箇所を insert セグメントにする', () => {
		const segments = computeInlineDiff('賛成です', '私は賛成です');
		expect(segments.some((s) => s.type === 'insert' && s.text.includes('私は'))).toBe(true);
	});

	it('置換は delete と insert の組み合わせで表現する', () => {
		const segments = computeInlineDiff('私は反対だ', '私は賛成だ');
		expect(segments.some((s) => s.type === 'delete')).toBe(true);
		expect(segments.some((s) => s.type === 'insert')).toBe(true);
		// 共通部分は equal で残る
		expect(segments.some((s) => s.type === 'equal' && s.text.includes('私は'))).toBe(true);
	});

	it('セグメントを連結すると編集後テキストに一致する（equal + insert）', () => {
		const original = 'あー、つまり結論としては反対です';
		const edited = '結論としては賛成です';
		const segments = computeInlineDiff(original, edited);
		const reconstructed = segments
			.filter((s) => s.type !== 'delete')
			.map((s) => s.text)
			.join('');
		expect(reconstructed).toBe(edited);
	});

	it('セグメントを連結すると原本テキストに一致する（equal + delete）', () => {
		const original = 'あー、つまり結論としては反対です';
		const edited = '結論としては賛成です';
		const segments = computeInlineDiff(original, edited);
		const reconstructed = segments
			.filter((s) => s.type !== 'insert')
			.map((s) => s.text)
			.join('');
		expect(reconstructed).toBe(original);
	});
});
