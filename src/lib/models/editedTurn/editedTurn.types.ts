import type { SpeakerType } from '$lib/models/turn/turn.types';

// 編集後ターンの永続形。散文・発話者・由来のみを持ち、
// 信念変化・ファクトチェック等の注釈は原本を真実として sourceTurnIds で join 表示する。
export type EditedTurnForFirestore = {
	id: string;
	sourceTurnIds: string[]; // 由来する原本ターン id（>=1、連結時は複数）
	speakerType: SpeakerType;
	personaId?: string | null;
	content: string;
	speechMode?: 'opinion' | 'fact' | 'question';
};

// 実行時形。編集後ターンは Timestamp を持たないため永続形と一致する。
export type EditedTurn = EditedTurnForFirestore;
