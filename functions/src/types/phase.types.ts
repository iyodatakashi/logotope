// 永続する phase の slug 型（FE PhaseSlug と値集合・順序を一致させる）。
// 正準 slug リスト（順序込み）:
// ['theme', 'fact-research', 'personas', 'chapters', 'debate', 'editing', 'publish']
export type PhaseSlug =
	| 'theme'
	| 'fact-research'
	| 'personas'
	| 'chapters'
	| 'debate'
	| 'editing'
	| 'publish';

// 永続する状態（stopped は全フェーズ共通の失敗・停止状態）。FE PhaseStatus と一致させる。
export type PhaseStatus = 'not_started' | 'running' | 'generated' | 'stopped';
