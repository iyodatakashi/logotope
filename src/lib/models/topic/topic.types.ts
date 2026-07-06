import { Timestamp } from 'firebase/firestore';
import type { PhaseSlug, PhaseStatus } from '$lib/models/phase/phase.types';
import type { FactBase } from '$lib/models/factBase/factBase.types';

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
	// 承認済み事実基盤（共通前提）。ユーザー提供資料（sourceContents）とは別データ。
	factBase?: FactBase;
};

type TopicBaseForFirestore = {
	id: string;
	title: string;
	description?: string;
	sourceUrls?: string[];
	fetchedSourceContents?: FetchedSourceContentForFirestore[];
	sourceContentsFetchedAt?: Timestamp;
	phase: PhaseSlug;
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

export type EngagementLevel = 'high' | 'medium' | 'low';
