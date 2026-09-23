export type StakeholderForFirestore = {
	// サーバが生成時に付番する安定 id。ペルソナの由来対応づけの突合キーとなる。
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

// 都道府県。47件の有限集合（functions/src/constants/surname-regions.ts の PREFECTURES をミラーする）。
export type Prefecture =
	| '北海道'
	| '青森県'
	| '岩手県'
	| '宮城県'
	| '秋田県'
	| '山形県'
	| '福島県'
	| '茨城県'
	| '栃木県'
	| '群馬県'
	| '埼玉県'
	| '千葉県'
	| '東京都'
	| '神奈川県'
	| '新潟県'
	| '富山県'
	| '石川県'
	| '福井県'
	| '山梨県'
	| '長野県'
	| '岐阜県'
	| '静岡県'
	| '愛知県'
	| '三重県'
	| '滋賀県'
	| '京都府'
	| '大阪府'
	| '兵庫県'
	| '奈良県'
	| '和歌山県'
	| '鳥取県'
	| '島根県'
	| '岡山県'
	| '広島県'
	| '山口県'
	| '徳島県'
	| '香川県'
	| '愛媛県'
	| '高知県'
	| '福岡県'
	| '佐賀県'
	| '長崎県'
	| '熊本県'
	| '大分県'
	| '宮崎県'
	| '鹿児島県'
	| '沖縄県';

// ステークホルダーは採用選択を持たない中間生成物。表示専用のためアプリ層でも永続形と同一。
export type Stakeholder = StakeholderForFirestore;
