export type FetchedSourceContent = {
	url: string;
	content: string;
	fetchedAt: string;
};

export type TopicContext = {
	description?: string;
	sourceContents?: string[];
};

export type Topic = {
	id: string;
	title: string;
	description?: string;
	sourceUrls?: string[];
	fetchedSourceContents?: FetchedSourceContent[];
	createdAt: string;
	updatedAt: string;
};
