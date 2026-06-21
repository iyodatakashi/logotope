import type { Timestamp } from 'firebase-admin/firestore';

export type FetchedSourceContent = {
	url: string;
	content: string;
	fetchedAt: Timestamp;
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
	createdAt: Timestamp;
	updatedAt: Timestamp;
};
