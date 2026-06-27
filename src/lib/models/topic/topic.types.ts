import { Timestamp } from 'firebase/firestore';
import type { Phase, PhaseStatus } from '$lib/models/phase/phase.types';

export type FetchedSourceContentForFirestore = {
	url: string;
	content: string;
	fetchedAt: Timestamp;
};

export type FetchedSourceContent = {
	url: string;
	content: string;
	fetchedAt: Date;
};

export type TopicContext = {
	description?: string;
	sourceContents?: string[];
};

type TopicBaseForFirestore = {
	id: string;
	title: string;
	description?: string;
	sourceUrls?: string[];
	fetchedSourceContents?: FetchedSourceContentForFirestore[];
	sourceContentsFetchedAt?: Timestamp;
	phase: Phase;
	phaseStatus: PhaseStatus;
	personaCount?: number;
};

export type TopicForFirestore = TopicBaseForFirestore & {
	createdAt: Timestamp;
	updatedAt: Timestamp;
	publishedAt?: Timestamp;
};

// Firestoreから読み込んだ後のアプリ層型（Timestamp → Date 変換済み）
export type TopicInput = Omit<
	TopicBaseForFirestore,
	'fetchedSourceContents' | 'sourceContentsFetchedAt'
> & {
	fetchedSourceContents?: FetchedSourceContent[];
	sourceContentsFetchedAt?: Date;
	createdAt: Date;
	updatedAt: Date;
	publishedAt?: Date;
};

export const topicFromFirestore = (doc: TopicForFirestore): TopicInput => ({
	...doc,
	fetchedSourceContents: doc.fetchedSourceContents?.map((s) => ({
		...s,
		fetchedAt: s.fetchedAt.toDate()
	})),
	sourceContentsFetchedAt: doc.sourceContentsFetchedAt?.toDate(),
	createdAt: doc.createdAt.toDate(),
	updatedAt: doc.updatedAt.toDate(),
	publishedAt: doc.publishedAt?.toDate()
});

export type EngagementLevel = 'high' | 'medium' | 'low';
