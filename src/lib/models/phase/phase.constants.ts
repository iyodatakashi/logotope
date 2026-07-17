import type { PhaseDef } from './phase.types';

// 正準 slug リスト（順序込み）: ['theme', 'fact-research', 'personas', 'chapters', 'debate', 'editing', 'publish']
// 配列順 = フェーズ進行順の唯一の真実。BE 側 PhaseKey と値集合・順序を一致させる。
export const PHASE_DEFS: readonly PhaseDef[] = [
	{
		// テーマ設定は入力・承認のみで生成を伴わないため、phaseStatus は not_started のままで前進する
		// （running/generated/stopped にはならない）。
		key: 'theme',
		statusLabels: {
			not_started: 'テーマ設定中',
			running: 'テーマ設定中',
			generated: 'テーマ設定中',
			stopped: 'テーマ設定中'
		}
	},
	{
		key: 'fact-research',
		statusLabels: {
			not_started: '未着手',
			running: 'リサーチ中',
			generated: 'リサーチ完了',
			stopped: 'リサーチ停止'
		}
	},
	{
		// personas は「ステークホルダー生成→ペルソナ生成→取材」の一気通貫全体を1フェーズで表す。
		// phaseStatus は段階別ではなく全体1軸（未着手・実行中・完了・停止）で扱う。
		key: 'personas',
		statusLabels: {
			not_started: '未着手',
			running: 'ペルソナ生成中',
			generated: 'ペルソナ生成完了',
			stopped: 'ペルソナ生成停止'
		}
	},
	{
		key: 'chapters',
		statusLabels: {
			not_started: '取材承認済み',
			running: '章立て生成中',
			generated: '章立て準備中',
			stopped: '章立て生成停止'
		}
	},
	{
		key: 'debate',
		statusLabels: {
			not_started: '章立て完了',
			running: '討論中',
			generated: '討論完了',
			stopped: '討論停止'
		}
	},
	{
		key: 'editing',
		statusLabels: {
			not_started: '討論完了',
			running: '編集中',
			generated: '編集完了',
			stopped: '編集停止'
		}
	},
	{
		// publish は公開 ON/OFF を可逆トグル（published）で扱うフェーズで、phaseStatus は
		// publish フェーズでは意味を持たない（not_started のまま動かさない）。実際のバッジは
		// phaseDisplayLabel の publish 分岐が published から導出するため、statusLabels は
		// 全状態フォールバック（'未公開'）として定義する（theme と同様の特例）。
		key: 'publish',
		statusLabels: {
			not_started: '未公開',
			running: '未公開',
			generated: '未公開',
			stopped: '未公開'
		}
	}
];
