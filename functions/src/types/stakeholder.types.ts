import type { PREFECTURES } from '../constants/surname-regions.js';

// 永続形（stakeholders/0 の配列要素）。id はサーバが生成時に付番する安定識別子で、
// 配列位置に依存しない。ペルソナの由来対応づけ・採用選択の唯一の突合キーとなる。
export type Stakeholder = {
	id: string;
	role: string;
	// 問われていることに対してどう当事者か。stakeLevel の根拠。
	stakeReason: string;
	mainInterests: string[];
	// その立場が属する国。テーマが国を決めているときだけ持つ。
	country?: string;
	// 日本国内で土地が立場の本質のときだけ持つ。姓の地域性の入力になる。
	prefecture?: Prefecture;
	stakeLevel: StakeLevel;
	minorityLevel: MinorityLevel;
	engagementLevel: EngagementLevel;
};

// 当事者性。問われていることが自分の生活・利害にどれだけ直接刺さるか。少数性・専門性とは独立。
export type StakeLevel = 'high' | 'medium' | 'low';
export type MinorityLevel = 'high' | 'medium' | 'low';
export type EngagementLevel = 'high' | 'medium' | 'low';

// 都道府県。47件の有限集合なので生成スキーマでそのまま受け取れ、表記の正規化を要さない。
export type Prefecture = (typeof PREFECTURES)[number];
