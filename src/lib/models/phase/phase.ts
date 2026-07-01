import type { Phase, PhaseStatus, PhaseLogicalState } from '$lib/models/phase/phase.types';
import {
	PHASE_DEFS,
	RUNNING_LABEL,
	STOPPED_LABEL,
	GENERATED_LABEL,
	NOT_STARTED_LABEL
} from '$lib/models/phase/phase.constants';

export const phasePath = (topicId: string, phase: Phase): string => {
	const phaseDefinition = PHASE_DEFS.find((entry) => entry.phase === phase) ?? PHASE_DEFS[0];
	return `/admin/topics/${topicId}/${phaseDefinition.slug}`;
};

// (phase, phaseStatus) と対象フェーズ番号のみから表示状態を導出する純粋関数。
// セッション・クライアントのヒントは参照しない（トピック状態のみで完結）。
export const phaseLogicalState = (
	current: { phase: Phase; phaseStatus: PhaseStatus },
	target: Phase
): PhaseLogicalState => {
	if (target < current.phase) return 'approved';
	if (target > current.phase) return 'not_started';
	// target === current.phase: phaseStatus（not_started/running/generated/stopped）をそのまま返す
	return current.phaseStatus;
};

// ダッシュボード一覧のバッジ用に (phase, phaseStatus) からラベル/スタイルキーを導出する
export const phaseDisplayLabel = (current: {
	phase: Phase;
	phaseStatus: PhaseStatus;
}): { label: string; styleKey: string } => {
	const { phase, phaseStatus } = current;
	if (phaseStatus === 'running') return { label: RUNNING_LABEL[phase], styleKey: 'running' };
	if (phaseStatus === 'stopped') return { label: STOPPED_LABEL[phase], styleKey: 'stopped' };
	if (phaseStatus === 'generated')
		return { label: GENERATED_LABEL[phase], styleKey: phase === 6 ? 'completed' : 'ready' };
	return { label: NOT_STARTED_LABEL[phase], styleKey: 'pending' };
};
