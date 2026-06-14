export type EngagementEntry = {
	personaId: string;
	score: number;
	mode: 'opinion' | 'fact' | 'reaction' | 'none';
};

export type EngagementHistoryEntry = {
	score: number;
	mode: 'opinion' | 'fact' | 'reaction' | 'none';
	intentSummary?: string;
};

export type PendingIntentEntry = {
	triggerTurnIndex: number;
	intentSummary: string;
};

export type EngagementDoc = {
	history: Record<string, EngagementHistoryEntry>;
	pendingIntents: PendingIntentEntry[];
};
