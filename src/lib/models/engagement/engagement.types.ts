export type EngagementHistoryEntry = {
	score: number;
	mode: 'opinion' | 'fact' | 'none';
	intentSummary?: string;
};

// 表示・集約用の派生: 気づき履歴エントリに結合キー（turnId / personaId）を付与した形。
// 解決済みラベル（話者名）は持たず、name は描画時に personaMap で解決する（責務境界・Req 7.1/7.3）。
export type EngagementHistoryEntryWithPersona = EngagementHistoryEntry & {
	turnId: string;
	personaId: string;
};
