import type { PhaseDef } from './phase.types';

// 正準 slug リスト（順序込み）: ['fact-research', 'stakeholders', 'personas', 'interviews', 'chapters', 'debate', 'editing']
// 配列順 = フェーズ進行順の唯一の真実。BE 側 PhaseKey と値集合・順序を一致させる。
export const PHASE_DEFS: readonly PhaseDef[] = [
	{
		key: 'fact-research',
		label: '事実リサーチ',
		statusLabels: {
			not_started: '未着手',
			running: 'リサーチ中',
			generated: 'リサーチ完了',
			stopped: 'リサーチ停止'
		}
	},
	{
		key: 'stakeholders',
		label: 'ステークホルダー調査',
		statusLabels: {
			not_started: '未着手',
			running: '調査中',
			generated: '調査完了',
			stopped: '調査停止'
		}
	},
	{
		key: 'personas',
		label: 'ペルソナ生成',
		statusLabels: {
			not_started: '調査承認済み',
			running: 'ペルソナ生成中',
			generated: 'ペルソナ生成完了',
			stopped: 'ペルソナ生成停止'
		}
	},
	{
		key: 'interviews',
		label: '取材',
		statusLabels: {
			not_started: 'ペルソナ承認済み',
			running: '取材中',
			generated: '取材完了',
			stopped: '取材停止'
		}
	},
	{
		key: 'chapters',
		label: '章立て',
		statusLabels: {
			not_started: '取材承認済み',
			running: '章立て生成中',
			generated: '章立て準備中',
			stopped: '章立て生成停止'
		}
	},
	{
		key: 'debate',
		label: '討論',
		statusLabels: {
			not_started: '章立て完了',
			running: '討論中',
			generated: '討論完了',
			stopped: '討論停止'
		}
	},
	{
		key: 'editing',
		label: '編集',
		statusLabels: {
			not_started: '討論完了',
			running: '編集中',
			generated: '編集完了',
			stopped: '編集停止'
		}
	}
];
