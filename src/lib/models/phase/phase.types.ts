export type Phase = 1 | 2 | 3 | 4 | 5 | 6;

export type PhaseSlug =
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

// フェーズの基本属性（ルーティングとステップナビで使う）。
// ボタン文言などUIラベルは各フェーズ画面が持つ（ここには置かない）。
export type PhaseDef = {
	phase: Phase;
	slug: PhaseSlug;
	label: string;
};
