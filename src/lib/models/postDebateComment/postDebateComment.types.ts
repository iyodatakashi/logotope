export type PostDebateCommentForFirestore = {
	id: string;
	personaId: string;
	content: string;
	sortOrder: number;
};

export type PostDebateCommentsForFirestore = {
	comments: PostDebateCommentForFirestore[];
};

export type PostDebateComment = {
	personaId: string;
	personaName: string;
	personaRole: string;
	content: string;
};
