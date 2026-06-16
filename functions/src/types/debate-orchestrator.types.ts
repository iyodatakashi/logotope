export interface OrchestratorOptions {
	turnsPerChapter: number;
	maxTurns: number;
	interventionCooldown: number; // 論点ずれ介入(A)専用（B はクールダウン不問）
	singleChapterMode?: boolean; // 動作確認用: 第1章のみで討論を完了させる
}
