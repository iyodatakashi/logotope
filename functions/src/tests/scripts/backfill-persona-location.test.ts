import { describe, it, expect } from 'vitest';
import { planLocationBackfill } from '../../scripts/backfill-persona-location.js';

describe('planLocationBackfill — homePrefecture/nationality → prefecture/country の改名', () => {
	it('居住都道府県を都道府県へ、国籍を国へそのまま移す', () => {
		expect(
			planLocationBackfill([
				{ ref: 't1/p1', name: '比嘉 美和', homePrefecture: '沖縄県', nationality: '日本' }
			])
		).toEqual([
			{
				ref: 't1/p1',
				name: '比嘉 美和',
				before: { homePrefecture: '沖縄県', nationality: '日本' },
				prefecture: '沖縄県',
				country: '日本',
				unreadablePrefecture: null
			}
		]);
	});

	it('空文字だった項目は未設定にする（空文字で不在を表す運用を終える）', () => {
		const [plan] = planLocationBackfill([
			{ ref: 't1/p2', name: 'ルイス・ハミルトン', homePrefecture: '', nationality: 'イギリス' }
		]);

		expect(plan.prefecture).toBeNull();
		expect(plan.country).toBe('イギリス');
	});

	it('国外の人物の国を捨てない', () => {
		const [plan] = planLocationBackfill([
			{ ref: 't1/p3', name: 'マリア・シルバ', homePrefecture: '', nationality: 'ブラジル' }
		]);

		expect(plan.country).toBe('ブラジル');
	});

	it('旧項目を持たない人物を対象外にする（再実行で同じ結果になる）', () => {
		expect(planLocationBackfill([{ ref: 't1/p4', name: '移行済み' }])).toEqual([]);
	});

	it('都道府県の正式表記として読めない値は推測で埋めず、手動判断として残す', () => {
		const [plan] = planLocationBackfill([
			{ ref: 't1/p5', name: '某', homePrefecture: '沖縄', nationality: '日本' }
		]);

		expect(plan.prefecture).toBeNull();
		expect(plan.unreadablePrefecture).toBe('沖縄');
	});

	it('国籍だけを持つ人物も対象にする', () => {
		const [plan] = planLocationBackfill([{ ref: 't1/p6', name: '某', nationality: '日本' }]);

		expect(plan.country).toBe('日本');
		expect(plan.prefecture).toBeNull();
	});

	it('旧項目が空文字だけの人物も対象にし、両項目を未設定にして旧項目を落とす', () => {
		const [plan] = planLocationBackfill([
			{ ref: 't1/p7', name: '某', homePrefecture: '', nationality: '' }
		]);

		expect(plan).toEqual({
			ref: 't1/p7',
			name: '某',
			before: { homePrefecture: '', nationality: '' },
			prefecture: null,
			country: null,
			unreadablePrefecture: null
		});
	});
});
