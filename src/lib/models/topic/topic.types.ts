import { Timestamp } from 'firebase/firestore';
import type { PhaseSlug, PhaseStatus } from '$lib/models/phase/phase.types';

// 参考URLから取得した本文1件。
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

// トピックの Firestore 永続型（topics/{id}）。
export type TopicForFirestore = {
	id: string;
	title: string;
	description?: string;
	sourceUrls?: string[];
	fetchedSourceContents?: FetchedSourceContentForFirestore[];
	sourceContentsFetchedAt?: Timestamp;
	phase: PhaseSlug;
	phaseStatus: PhaseStatus;
	personaCount?: number;
	createdAt: Timestamp;
	updatedAt: Timestamp;
	publishedAt?: Timestamp;
};

// トピックのアプリ層型（Timestamp → Date 変換済み）。createTopicStates の入力となる。
export type Topic = {
	id: string;
	title: string;
	description?: string;
	sourceUrls?: string[];
	fetchedSourceContents?: FetchedSourceContent[];
	sourceContentsFetchedAt?: Date;
	phase: PhaseSlug;
	phaseStatus: PhaseStatus;
	personaCount?: number;
	createdAt: Date;
	updatedAt: Date;
	publishedAt?: Date;
};
