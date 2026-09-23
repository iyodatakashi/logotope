import { describe, it, expect } from 'vitest';
import type {
	StakeholderForFirestore,
	Stakeholder,
	StakeLevel,
	MinorityLevel,
	EngagementLevel,
	Prefecture
} from '$lib/models/stakeholder/stakeholder.types';

// functions/src/types/stakeholder.types.ts のミラー。BE 型と形が一致することを型で固定する
// （svelte-check がこのファイルを型検査するため、ズレればビルドで落ちる）。
describe('stakeholder.types（FE ミラー） 立場の永続形', () => {
	it('所在（国・都道府県）・3軸・当事者である理由を持つ', () => {
		const stakeholder: StakeholderForFirestore = {
			id: 's1',
			role: '大手AI開発企業の安全性研究部門ディレクター',
			stakeReason: '減速を主張する当事者として社内の意思決定に関与している',
			mainInterests: ['安全性評価', '公開の可否'],
			country: 'アメリカ合衆国',
			stakeLevel: 'high',
			minorityLevel: 'low',
			engagementLevel: 'high'
		};

		expect(stakeholder.stakeReason).toContain('当事者');
		expect(stakeholder.country).toBe('アメリカ合衆国');
		expect(stakeholder.stakeLevel).toBe('high');
		expect('reason' in stakeholder).toBe(false);
	});

	it('所在は国・都道府県のいずれも持たない状態を許す', () => {
		const stakeholder: StakeholderForFirestore = {
			id: 's2',
			role: '毎日満員電車で通勤する会社員',
			stakeReason: '混雑の当事者として日々の通勤で影響を受ける',
			mainInterests: ['通勤の負担'],
			stakeLevel: 'medium',
			minorityLevel: 'low',
			engagementLevel: 'low'
		};

		expect(stakeholder.country).toBeUndefined();
		expect(stakeholder.prefecture).toBeUndefined();
	});

	it('都道府県は47件の有限集合として持つ', () => {
		const prefecture: Prefecture = '沖縄県';
		const stakeholder: StakeholderForFirestore = {
			id: 's3',
			role: '基地周辺で暮らす住民',
			stakeReason: '騒音と事故の危険を日常として引き受けている',
			mainInterests: ['騒音'],
			country: '日本',
			prefecture,
			stakeLevel: 'high',
			minorityLevel: 'high',
			engagementLevel: 'medium'
		};

		expect(stakeholder.prefecture).toBe('沖縄県');
	});

	it('3軸は互いに独立した同じ値域を持つ', () => {
		const stake: StakeLevel = 'high';
		const minority: MinorityLevel = 'low';
		const engagement: EngagementLevel = 'medium';

		expect([stake, minority, engagement]).toEqual(['high', 'low', 'medium']);
	});

	it('アプリ層の Stakeholder は永続形と同一（採用選択を持たない中間生成物）', () => {
		const stakeholder: Stakeholder = {
			id: 's4',
			role: '立場',
			stakeReason: '理由',
			mainInterests: [],
			stakeLevel: 'low',
			minorityLevel: 'low',
			engagementLevel: 'low'
		};

		expect('selected' in stakeholder).toBe(false);
	});
});
