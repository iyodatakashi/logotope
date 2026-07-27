import { Timestamp } from 'firebase/firestore';
import type { EngagementLevel } from '$lib/models/stakeholder/stakeholder.types';

// 不変の信念のみ（interview が version 0 を書き、討論は上書きしない）
export type BeliefForFirestore = {
	id: string;
	version: number;
	content: string;
	createdAt: Timestamp;
};

export type Belief = Omit<BeliefForFirestore, 'createdAt'> & { createdAt: Date };

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

export type Awareness = Omit<AwarenessForFirestore, 'createdAt'> & { createdAt: Date };

export type SearchResult = { title: string; url: string };
export type SearchSource = { query: string; summary: string; results: SearchResult[] };

export type DraftBelief = {
	stanceAndGrounds: string;
	coreClaims: string;
	concerns: string;
	values: string;
	compromisePoints: string;
	changePotential: string;
};

export type InterviewForFirestore = {
	draftBelief?: DraftBelief;
	verificationReport?: string;
	interviewRecord?: string;
	sources?: SearchSource[];
	status: 'queued' | 'in_progress' | 'completed' | 'error';
	errorMessage?: string;
	completedAt?: Timestamp;
};

export type Interview = Omit<InterviewForFirestore, 'completedAt'> & { completedAt?: Date };

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

export type PersonaForFirestore = {
	id: string;
	topicId: string;
	stakeholderRole: string;
	// 由来ステークホルダーの安定 id。永続時に必ず付与される。
	stakeholderId: string;
	// 具体的立場（旧 specificRole）。必須・非空。非空は書き込み入口の検証で保証する（総称で自動置換しない）。
	role: string;
	name: string;
	age: number;
	occupation: string;
	background: string;
	interests: string;
	nationality: string;
	engagementLevel?: EngagementLevel;
	gender: PersonaGender;
	genderPresentation: PersonaGenderPresentation;
	// パレット系統名のみ（濃淡は持たない）。生成時に1回だけ決まり、以後再計算しない。
	colorKey: string;
	// アバター画像の生成時刻。存在フラグ兼キャッシュバスター。未設定は未生成/失敗を意味する。
	avatarGeneratedAt?: Timestamp;
	// 討論参加の採用選択。生成時に true を焼き込み、以降ペルソナ単位で切替可能。
	selected: boolean;
	sortOrder: number;
	interview?: InterviewForFirestore;
	beliefs: BeliefForFirestore[];
	awarenesses?: AwarenessForFirestore[];
};

export type Persona = Omit<
	PersonaForFirestore,
	'interview' | 'beliefs' | 'awarenesses' | 'avatarGeneratedAt'
> & {
	interview?: Interview;
	beliefs: Belief[];
	awarenesses?: Awareness[];
	avatarGeneratedAt?: Date;
};

// Admin・公開が共通で使う軽量な表示用ペルソナ型。発言アイテム（PersonaPostItem）などの描画に必要な
// 最小フィールドのみを持つ。管理専用フィールド・nationality は含めない（描画に不要・payload 純度を保つ）。
// topicId/id/avatarGeneratedAt はアバター画像パス（topics/{topicId}/avatars/{id}）の構築に PersonaAvatar が使う。
export type PersonaForDisplay = {
	id: string;
	topicId: string;
	name: string;
	// 必須。永続 role をそのまま持つ（?? stakeholderRole の導出はしない）。
	role: string;
	// 外見。欠落は未設定を意味し、表示側（PersonaAvatar）が既定へ縮退させる。
	colorKey?: string;
	// アバター画像の生成時刻。存在フラグ兼キャッシュバスター。
	avatarGeneratedAt?: Date;
};

// ランタイム Persona から表示に必要な最小フィールドのみを抽出する（唯一の Admin 側写像入口・導出なし）。
// 公開側は builder が永続読み取りから同型を組む。
export const toPersonaForDisplay = (persona: Persona): PersonaForDisplay => ({
	id: persona.id,
	topicId: persona.topicId,
	name: persona.name,
	role: persona.role,
	colorKey: persona.colorKey,
	avatarGeneratedAt: persona.avatarGeneratedAt
});
