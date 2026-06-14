export type EngagementEntry = {
	personaId: string;
	score: number;
	mode: 'opinion' | 'fact' | 'none';
};

export type EngagementHistoryEntry = {
	score: number;
	mode: 'opinion' | 'fact' | 'none';
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
