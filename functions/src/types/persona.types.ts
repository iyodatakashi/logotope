import type { Timestamp } from 'firebase-admin/firestore';
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

// interview の永続サブ型は型レイヤーへ集約する（重複定義の解消・依存方向の是正）。
// interview 生成（interview-agent）・grounding は個別定義せず、ここを参照する。型は agents/search に依存しない。
export type SearchResult = { title: string; url: string };
export type SearchSource = { query: string; summary: string; results: SearchResult[] };

export type DraftBelief = {
	stanceAndGrounds: string;
	coreClaims: string;
	concerns: string;
	values: string;
	compromisePoints: string;
	changePotential: string;
	perceivedFacts?: string; // 立場から見た事実（層②のドラフト・非破壊加算）
};

// 取材結果。Firestore の persona 文書の interview オブジェクトに単一保存される永続形。FE とミラーする。
// runtime の非対称は意図的: functions runtime Persona はこれを interviewRecord: string へ平坦化する。
export type InterviewForFirestore = {
	draftBelief?: DraftBelief;
	verificationReport?: string;
	interviewRecord?: string;
	sources?: SearchSource[];
	status: 'queued' | 'in_progress' | 'completed' | 'error';
	errorMessage?: string;
	completedAt?: Timestamp;
};

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

// ペルソナの永続形（Firestore の topics/{id}/personas/{personaId} 文書構造）。FE PersonaForFirestore とミラーする。
export type PersonaForFirestore = {
	id: string;
	topicId: string;
	name: string;
	age: number;
	occupation: string;
	stakeholderRole: string;
	// 由来ステークホルダーの安定 id。永続時に必ず付与される。
	stakeholderId: string;
	// 具体的立場（旧 specificRole）。必須・非空。非空は書き込み入口の検証で保証する（総称で自動置換しない）。
	role: string;
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
	interview?: InterviewForFirestore;
};

// ランタイム Persona は永続形から派生する。永続の interview オブジェクトを interviewRecord: string へ平坦化する
// （討論パイプラインの都合。この非対称は意図的で、型と写像の両方で明示する）。他フィールドは永続形のまま。
export type Persona = Omit<PersonaForFirestore, 'interview'> & {
	interviewRecord?: string;
};
