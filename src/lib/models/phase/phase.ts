import type {
	PhaseSlug,
	PhaseStatus,
	PhaseLogicalState,
	StepNavItem
} from '$lib/models/phase/phase.types';
import { PHASE_DEFS, STEP_NAV_GROUPS } from '$lib/models/phase/phase.constants';

// 配列位置。未知キーは不正入力として 0（先頭）にフォールバックする。
export const phaseOrder = (key: PhaseSlug): number => {
	const index = PHASE_DEFS.findIndex((entry) => entry.key === key);
	return index === -1 ? 0 : index;
};

// 次フェーズの slug。最終フェーズ（または未知キー）なら null。
export const nextPhase = (key: PhaseSlug): PhaseSlug | null => {
	const index = PHASE_DEFS.findIndex((entry) => entry.key === key);
	if (index === -1 || index >= PHASE_DEFS.length - 1) return null;
	return PHASE_DEFS[index + 1].key;
};

export const isLastPhase = (key: PhaseSlug): boolean => phaseOrder(key) === PHASE_DEFS.length - 1;

export const phasePath = (topicId: string, phase: PhaseSlug): string => {
	const phaseDefinition = PHASE_DEFS.find((entry) => entry.key === phase) ?? PHASE_DEFS[0];
	return `/admin/topics/${topicId}/${phaseDefinition.key}`;
};

// StepNav 用に、現在フェーズからナビ・グループ項目を導出する。
// - disabled: グループ先頭フェーズが現在フェーズより後（未到達）なら不活性。
// - href: グループが現在フェーズを含むならそのフェーズ、含まなければ先頭フェーズへのパス。
export const stepNavItems = (topicId: string, currentPhase: PhaseSlug): StepNavItem[] =>
	STEP_NAV_GROUPS.map((group) => {
		const containsCurrent = group.phases.includes(currentPhase);
		const targetPhase = containsCurrent ? currentPhase : group.phases[0];
		return {
			label: group.label,
			href: phasePath(topicId, targetPhase),
			disabled: phaseOrder(group.phases[0]) > phaseOrder(currentPhase),
			phases: group.phases
		};
	});

// (phase, phaseStatus) と対象フェーズのみから表示状態を導出する純粋関数。
// セッション・クライアントのヒントは参照しない（トピック状態のみで完結）。
export const phaseLogicalState = (
	current: { phase: PhaseSlug; phaseStatus: PhaseStatus },
	target: PhaseSlug
): PhaseLogicalState => {
	const targetOrder = phaseOrder(target);
	const currentOrder = phaseOrder(current.phase);
	if (targetOrder < currentOrder) return 'approved';
	if (targetOrder > currentOrder) return 'not_started';
	// target === current.phase: phaseStatus をそのまま返す
	return current.phaseStatus;
};

// ダッシュボード一覧のバッジ用に (phase, phaseStatus) からラベル/スタイルキーを導出する
export const phaseDisplayLabel = (current: {
	phase: PhaseSlug;
	phaseStatus: PhaseStatus;
}): { label: string; styleKey: string } => {
	const { phase, phaseStatus } = current;
	const phaseDefinition = PHASE_DEFS.find((entry) => entry.key === phase) ?? PHASE_DEFS[0];
	const label = phaseDefinition.statusLabels[phaseStatus];
	if (phaseStatus === 'running') return { label, styleKey: 'running' };
	if (phaseStatus === 'stopped') return { label, styleKey: 'stopped' };
	if (phaseStatus === 'generated')
		return { label, styleKey: isLastPhase(phase) ? 'completed' : 'ready' };
	return { label, styleKey: 'pending' };
};
