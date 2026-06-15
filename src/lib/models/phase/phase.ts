import type { Phase, PhaseDef, PhaseStatus, PhaseLogicalState } from './phase.types';

export const PHASE_DEFS: readonly PhaseDef[] = [
	{ phase: 1, slug: 'stakeholders', label: 'ステークホルダー調査' },
	{ phase: 2, slug: 'personas', label: 'ペルソナ生成' },
	{ phase: 3, slug: 'interviews', label: '取材' },
	{ phase: 4, slug: 'chapters', label: '章立て' },
	{ phase: 5, slug: 'debate', label: '討論' }
];

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

const RUNNING_LABEL: Record<Phase, string> = {
	1: '調査中',
	2: 'ペルソナ生成中',
	3: '取材中',
	4: '章立て生成中',
	5: '討論中'
};

const GENERATED_LABEL: Record<Phase, string> = {
	1: '調査完了',
	2: 'ペルソナ生成完了',
	3: '取材完了',
	4: '章立て準備中',
	5: '討論完了'
};

const NOT_STARTED_LABEL: Record<Phase, string> = {
	1: '未着手',
	2: '調査承認済み',
	3: 'ペルソナ承認済み',
	4: '取材承認済み',
	5: '章立て完了'
};

const STOPPED_LABEL: Record<Phase, string> = {
	1: '調査停止',
	2: 'ペルソナ生成停止',
	3: '取材停止',
	4: '章立て生成停止',
	5: '討論停止'
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
		return { label: GENERATED_LABEL[phase], styleKey: phase === 5 ? 'completed' : 'ready' };
	return { label: NOT_STARTED_LABEL[phase], styleKey: 'pending' };
};
