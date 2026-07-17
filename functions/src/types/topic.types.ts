import type { Timestamp } from 'firebase-admin/firestore';
import type { PhaseSlug, PhaseStatus } from './phase.types.js';
import type { FactBase } from './factBase.types.js';

// 参考URLから取得した本文1件。
export type FetchedSourceContentForFirestore = {
	url: string;
	content: string;
	fetchedAt: Timestamp;
};

// トピックの Firestore 永続型（topics/{id}）。FE TopicForFirestore と同一形。
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
	// 公開状態の真実。publish/unpublish 操作のみが書く。欠落 = 非公開（FE TopicForFirestore と同一形）。
	published?: boolean;
	publishedAt?: Timestamp;
};

// 全生成フェーズへ同一値で渡す共有コンテキスト（永続しない合成物）。
// 生成経路は pipeline/topics/topic-context.ts の getTopicContext 一本に限る。
export type TopicContext = {
	description?: string;
	sourceContents?: string[];
	// 承認済み事実基盤（共通前提）。ユーザー提供資料（sourceContents）とは別データ。
	factBase?: FactBase;
};
