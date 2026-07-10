export type PhaseSlug =
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

// フェーズの基本属性（ルーティング・ステップナビ・バッジラベルで使う）。
// 配列順が進行順の唯一の真実。状態別ラベルを内包する（番号キー Record は持たない）。
// ボタン文言などUIラベルは各フェーズ画面が持つ（ここには置かない）。
export type PhaseDef = {
	key: PhaseSlug;
	label: string; // ステップ名（StepNav 用）
	statusLabels: Record<PhaseStatus, string>; // バッジ表示
};

// StepNav のナビ・グループ。複数フェーズを1ステップに束ねる（例: ペルソナ準備＝3フェーズ）。
// 画面別分岐を作らず、グローバルなナビ定義として一元管理する。
export type StepNavGroup = {
	label: string;
	phases: PhaseSlug[]; // このステップに束ねるフェーズ（進行順）
};

// 現在フェーズから導出した StepNav 表示項目。
export type StepNavItem = {
	label: string;
	href: string;
	disabled: boolean;
	phases: PhaseSlug[];
};
