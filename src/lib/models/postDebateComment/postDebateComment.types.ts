export type PostDebateCommentDoc = {
	id: string;
	personaId: string;
	content: string;
	sortOrder: number;
};

export type PostDebateCommentsDoc = {
	comments: PostDebateCommentDoc[];
};

export type PostDebateComment = {
	personaId: string;
	personaName: string;
	personaRole: string;
	content: string;
};
