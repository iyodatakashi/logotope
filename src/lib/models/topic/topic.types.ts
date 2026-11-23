import type { Timestamp } from 'firebase/firestore';
import type { createTopic } from '#lib/models/topic/createTopic.svelte.ts';
import type { PhaseSlug, PhaseStatus } from '#lib/models/phase/phase.types.ts';

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
	// 公開状態の真実。publish/unpublish 操作のみが書く。欠落 = 非公開（既存トピックの現実を型が反映する）。
	published?: boolean;
	publishedAt?: Timestamp;
};

// トピックのアプリ層型（Timestamp → Date 変換済み）。createTopic の入力となる。
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
	// アプリ層では常に boolean（読み込み境界 toTopic で欠落を false に正規化する）。
	published: boolean;
	publishedAt?: Date;
};

// 画面が扱う「生きたトピック」。アプリ層型 Topic に $state と各種操作を載せたもの。
export type TopicStates = ReturnType<typeof createTopic>;
