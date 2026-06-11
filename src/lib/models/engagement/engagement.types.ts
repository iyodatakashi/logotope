export type EngagementEntry = {
	personaId: string;
	score: number;
	mode: 'full' | 'reaction' | 'none';
};

export type EngagementHistoryEntry = {
	score: number;
	mode: 'full' | 'reaction' | 'none';
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
