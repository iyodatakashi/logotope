import { Timestamp } from 'firebase/firestore';
import type { DebateStatus, StakeholderDoc } from '$lib/types/index.js';

export interface TopicDoc {
	id: string;
	title: string;
	status: DebateStatus;
	createdAt: Timestamp;
	updatedAt: Timestamp;
	publishedAt?: Timestamp;
	personaCount?: number;
	stakeholders?: {
		items: StakeholderDoc[];
		approved: boolean;
		createdAt: Timestamp;
	};
}
