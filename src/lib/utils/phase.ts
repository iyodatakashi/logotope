export type Phase = 1 | 2 | 3 | 4 | 5;

export type PhaseSlug = 'stakeholders' | 'personas' | 'interviews' | 'chapters' | 'debate';

// 永続する状態（stopped は全フェーズ共通の失敗・停止状態。error は stopped に集約）
export type PhaseStatus = 'not_started' | 'running' | 'generated' | 'stopped';

// 表示用の論理状態（approved は phase 比較で導出するのみで永続しない）
export type PhaseLogicalState = PhaseStatus | 'approved';

// generated 状態での主操作。現状は承認のみ（publish は今回スコープ外・将来 kind 追加余地）
export type ForwardAction = { kind: 'approve'; label: string };

export interface PhaseDef {
	phase: Phase;
	slug: PhaseSlug;
	label: string;
	generateLabel: string; // not_started のボタン文言
	forwardAction?: ForwardAction; // generated の主操作。フェーズ5は未定義（承認なし）
	regenerateLabel: string; // 再生成（フェーズ5は「最初からやり直す」）
	regenerateConfirm: { title: string; description: string; submitLabel: string };
	stoppable?: boolean; // running 中に停止可（フェーズ5のみ）
	restartable?: boolean; // stopped から再開可（フェーズ5のみ）
	stopLabel?: string; // stoppable フェーズの停止ボタン文言
	restartLabel?: string; // restartable フェーズの再開ボタン文言
}

const APPROVE_LABEL = '承認して次へ進む';

export const PHASE_DEFS: readonly PhaseDef[] = [
	{
		phase: 1,
		slug: 'stakeholders',
		label: 'ステークホルダー調査',
		generateLabel: '調査を開始する',
		forwardAction: { kind: 'approve', label: APPROVE_LABEL },
		regenerateLabel: '再生成する',
		regenerateConfirm: {
			title: 'ステークホルダーを再生成しますか？',
			description:
				'現在のステークホルダーと、以降のフェーズで生成済みのデータ（ペルソナ・取材・章立て・討論）が削除されます。',
			submitLabel: '再生成する'
		}
	},
	{
		phase: 2,
		slug: 'personas',
		label: 'ペルソナ生成',
		generateLabel: 'ペルソナを生成する',
		forwardAction: { kind: 'approve', label: APPROVE_LABEL },
		regenerateLabel: '再生成する',
		regenerateConfirm: {
			title: 'ペルソナを再生成しますか？',
			description:
				'現在のペルソナと、以降のフェーズで生成済みのデータ（取材・章立て・討論）が削除されます。',
			submitLabel: '再生成する'
		}
	},
	{
		phase: 3,
		slug: 'interviews',
		label: '取材',
		generateLabel: '取材を開始する',
		forwardAction: { kind: 'approve', label: APPROVE_LABEL },
		regenerateLabel: '再取材する',
		regenerateConfirm: {
			title: '取材をやり直しますか？',
			description: '現在の取材記録と、以降のフェーズで生成済みのデータ（章立て・討論）が削除されます。',
			submitLabel: '再取材する'
		}
	},
	{
		phase: 4,
		slug: 'chapters',
		label: '章立て',
		generateLabel: '章立てを生成する',
		forwardAction: { kind: 'approve', label: APPROVE_LABEL },
		regenerateLabel: '再生成する',
		regenerateConfirm: {
			title: '章立てを再生成しますか？',
			description: '現在の章立てと、生成済みの討論が削除されます。',
			submitLabel: '再生成する'
		}
	},
	{
		phase: 5,
		slug: 'debate',
		label: '討論',
		generateLabel: '討論を開始する',
		regenerateLabel: '最初からやり直す',
		regenerateConfirm: {
			title: '討論を最初からやり直しますか？',
			description: '現在の討論内容がすべて削除され、最初から討論し直します。',
			submitLabel: '最初からやり直す'
		},
		stoppable: true,
		restartable: true,
		stopLabel: '討論を停止する',
		restartLabel: '討論を再開する'
	}
];

export const phasePath = (topicId: string, phase: Phase): string => {
	const def = PHASE_DEFS.find((d) => d.phase === phase) ?? PHASE_DEFS[0];
	return `/admin/topics/${topicId}/${def.slug}`;
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
