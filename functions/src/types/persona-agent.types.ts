import type { DebateChapter } from './index.js';
import type { DebateTurn } from './repository.types.js';

export interface TurnGenerationContext {
	chapterHistory: ReadonlyArray<DebateTurn>;
	chapter: DebateChapter;
	mode?: 'opinion' | 'fact';
	score?: number;
	intentSummary?: string;
	pendingTrigger?: { speakerName: string; content: string };
	nominatedByFacilitator: boolean;
}
