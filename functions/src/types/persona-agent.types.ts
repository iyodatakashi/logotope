import type { DebateChapter } from './debate.types.js';
import type { DebateTurn } from './repository.types.js';

export type TurnGenerationContext = {
	chapterHistory: ReadonlyArray<DebateTurn>;
	chapter: DebateChapter;
	mode?: 'opinion' | 'fact';
	score?: number;
	intentSummary?: string;
	pendingTrigger?: { speakerName: string; content: string };
	nominatedByFacilitator: boolean;
};
