import { describe, it, expect } from 'vitest';
import {
	runCastCompositionChecks,
	checkRegionalSurname,
	checkJapaneseSurnameLeftEmpty,
	checkNameFormat
} from '../../../pipeline/personas/cast-composition-checks.js';

describe('checkRegionalSurname — 地域色の強い県の姓', () => {
	it('地域に結びつく立場が出なかったテーマでは実施0件になる（異常ではない）', () => {
		const check = checkRegionalSurname([
			{ name: 'ルイス・ハミルトン' },
			{ name: '田中 太郎', prefecture: '東京都' }
		]);

		expect(check.checked).toBe(0);
		expect(check.failures).toEqual([]);
	});

	it('地域色の強い県に暮らす人物を実施件数に数える', () => {
		const check = checkRegionalSurname([
			{ name: '比嘉 美和', prefecture: '沖縄県' },
			{ name: '田中 太郎', prefecture: '東京都' }
		]);

		expect(check.checked).toBe(1);
	});

	it('地域の姓かどうかを事実として示し、外れても失敗にしない（比率どおりの揺れ）', () => {
		const inRegion = checkRegionalSurname([{ name: '比嘉 美和', prefecture: '沖縄県' }]);
		const outOfRegion = checkRegionalSurname([{ name: '佐藤 美和', prefecture: '沖縄県' }]);

		expect(inRegion.notes[0]).toContain('その地域の姓');
		expect(outOfRegion.notes[0]).toContain('全国の姓');
		expect(outOfRegion.failures).toEqual([]);
	});
});

describe('checkJapaneseSurnameLeftEmpty — 姓の決定を LLM に戻していないか', () => {
	it('カタカナの姓名は正常（その出自の氏名として LLM が返してよい）', () => {
		const check = checkJapaneseSurnameLeftEmpty([{ name: 'ルイス・ハミルトン' }]);

		expect(check.checked).toBe(1);
		expect(check.failures).toEqual([]);
	});

	it('中黒表記なのに漢字の姓名なら、姓の決定が LLM に戻っている', () => {
		const check = checkJapaneseSurnameLeftEmpty([{ name: '美和・郡司' }]);

		expect(check.failures).toHaveLength(1);
		expect(check.failures[0]).toContain('美和・郡司');
	});

	it('コードが姓を割り当てた人物（姓 名）は対象外', () => {
		const check = checkJapaneseSurnameLeftEmpty([{ name: '比嘉 美和', prefecture: '沖縄県' }]);

		expect(check.checked).toBe(0);
		expect(check.failures).toEqual([]);
	});
});

describe('checkNameFormat — 表示名の形式', () => {
	it('「姓 名」と「名・姓」をどちらも受理する', () => {
		const check = checkNameFormat([{ name: '比嘉 美和' }, { name: 'ルイス・ハミルトン' }]);

		expect(check.checked).toBe(2);
		expect(check.failures).toEqual([]);
	});

	it('区切りの無い名前を弾く', () => {
		expect(checkNameFormat([{ name: '比嘉美和' }]).failures).toHaveLength(1);
	});

	it('片側が空の中黒表記（姓が付かなかった名前）を弾く', () => {
		expect(checkNameFormat([{ name: '美和・' }]).failures).toHaveLength(1);
	});
});

describe('runCastCompositionChecks', () => {
	it('全ての検査が実施件数を持つ（0件と未実施を読み手が区別できる）', () => {
		const checks = runCastCompositionChecks([{ name: '比嘉 美和', prefecture: '沖縄県' }]);

		expect(checks).toHaveLength(3);
		for (const check of checks) {
			expect(typeof check.checked).toBe('number');
			expect(check.name.length).toBeGreaterThan(0);
		}
	});
});
