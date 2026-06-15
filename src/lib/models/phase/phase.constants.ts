import type { Phase, PhaseDef } from './phase.types';

export const PHASE_DEFS: readonly PhaseDef[] = [
	{ phase: 1, slug: 'stakeholders', label: 'ステークホルダー調査' },
	{ phase: 2, slug: 'personas', label: 'ペルソナ生成' },
	{ phase: 3, slug: 'interviews', label: '取材' },
	{ phase: 4, slug: 'chapters', label: '章立て' },
	{ phase: 5, slug: 'debate', label: '討論' }
];

export const RUNNING_LABEL: Record<Phase, string> = {
	1: '調査中',
	2: 'ペルソナ生成中',
	3: '取材中',
	4: '章立て生成中',
	5: '討論中'
};

export const GENERATED_LABEL: Record<Phase, string> = {
	1: '調査完了',
	2: 'ペルソナ生成完了',
	3: '取材完了',
	4: '章立て準備中',
	5: '討論完了'
};

export const NOT_STARTED_LABEL: Record<Phase, string> = {
	1: '未着手',
	2: '調査承認済み',
	3: 'ペルソナ承認済み',
	4: '取材承認済み',
	5: '章立て完了'
};

export const STOPPED_LABEL: Record<Phase, string> = {
	1: '調査停止',
	2: 'ペルソナ生成停止',
	3: '取材停止',
	4: '章立て生成停止',
	5: '討論停止'
};
