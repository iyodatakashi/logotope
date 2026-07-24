import type { EngagementLevel } from './stakeholder.types.js';

// 性のあり方は「性自認（その人が誰か）」と「外見表現（どう見えるか）」の2軸で持ち、1つに畳まない。
// 畳むと、性自認と外見が一致しない人を実際とは異なる姿で描いてしまう。
// アバター生成が使うのは genderPresentation のみ。gender は見た目の情報ではないため渡さない。
export type PersonaGender =
	| 'male' // 男性
	| 'female' // 女性
	| 'non-binary'; // 男性・女性のいずれにも当てはまらない

export type PersonaGenderPresentation =
	| 'masculine' // 男性的
	| 'feminine' // 女性的
	| 'neutral'; // 中性的（男女どちらとも判別しにくい外見）

export type Persona = {
	id: string;
	topicId: string;
	name: string;
	age: number;
	occupation: string;
	stakeholderRole: string;
	// 由来ステークホルダーの安定 id。永続時に必ず付与される。
	stakeholderId: string;
	specificRole: string;
	background: string;
	interests: string;
	nationality: string;
	engagementLevel: EngagementLevel;
	gender: PersonaGender;
	genderPresentation: PersonaGenderPresentation;
	// パレット系統名のみ（濃淡は持たない）。生成時に1回だけ決まり、以後再計算しない。
	colorKey: string;
	// アバター画像の生成時刻。存在フラグ兼キャッシュバスター。未設定は未生成/失敗を意味する。
	avatarGeneratedAt?: Timestamp;
	// 討論参加の採用選択。生成時に true を焼き込み、以降ペルソナ単位で切替可能。
	selected: boolean;
	sortOrder: number;
	beliefs?: Belief[];
	awarenesses?: AwarenessForFirestore[];
	interviewRecord?: string;
};

import type { Timestamp } from 'firebase-admin/firestore';

// 不変の信念のみ（interview が version 0 を書き、討論は上書きしない）
export type Belief = {
	id: string;
	version: number;
	content: string;
	createdAt: Timestamp;
};

// 他者視点の受容（reception）か自己発の気づき（self）か
export type AwarenessKind = 'reception' | 'self';

// 討論中の気づき（追記のみ・非破壊）。ターンに帰属し、reception は由来ペルソナを持つ
export type AwarenessForFirestore = {
	id: string;
	kind: AwarenessKind;
	content: string;
	sourcePersonaId: string | null;
	triggeredByTurnId: string;
	createdAt: Timestamp;
};
