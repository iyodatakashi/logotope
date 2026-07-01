export type EditedPostDebateCommentForFirestore = {
	id: string;
	sourceCommentId: string;
	personaId: string;
	content: string;
	sortOrder: number;
};

export type EditedPostDebateCommentsForFirestore = {
	comments: EditedPostDebateCommentForFirestore[];
};

// 実行時の表示形。ペルソナ名・役割は原本の personas から解決して補う。
export type EditedPostDebateComment = {
	personaId: string;
	personaName: string;
	personaRole: string;
	content: string;
};
