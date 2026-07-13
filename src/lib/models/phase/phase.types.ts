export type PhaseSlug =
	| 'theme'
	| 'fact-research'
	| 'stakeholders'
	| 'personas'
	| 'interviews'
	| 'chapters'
	| 'debate'
	| 'editing';

// 永続する状態（stopped は全フェーズ共通の失敗・停止状態。error は stopped に集約）
export type PhaseStatus = 'not_started' | 'running' | 'generated' | 'stopped';

// 表示用の論理状態（approved は phase 比較で導出するのみで永続しない）
export type PhaseLogicalState = PhaseStatus | 'approved';

// フェーズの基本属性（ルーティング・バッジラベルで使う）。
// 配列順が進行順の唯一の真実。状態別ラベルを内包する（番号キー Record は持たない）。
// ステップ名・ボタン文言などUIラベルは各UI側が持つ（ここには置かない）。
export type PhaseDef = {
	key: PhaseSlug;
	statusLabels: Record<PhaseStatus, string>; // バッジ表示
};
