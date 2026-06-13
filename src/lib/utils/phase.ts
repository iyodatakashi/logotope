import type { DebateStatus } from '$lib/models/topic/topic.types.js';
import type { SessionStatus } from '$lib/models/session/session.types.js';

export type Phase = 1 | 2 | 3 | 4 | 5;

export type PhaseSlug = 'stakeholders' | 'personas' | 'interviews' | 'chapters' | 'debate';

// 永続する状態（approved/stopped は永続せず導出する）
export type PhaseStatus = 'not_started' | 'running' | 'generated';

// 表示用の論理状態（approved は導出、stopped はフェーズ5のみ）
export type PhaseLogicalState = 'not_started' | 'running' | 'stopped' | 'generated' | 'approved';

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

const STATUS_PHASE_MAP: Record<DebateStatus, Phase> = {
	pending: 1,
	surveying: 1,
	generating_personas: 2,
	interviewing: 3,
	chapters_ready: 4,
	chapters_approved: 5,
	debating: 5,
	cancelled: 4,
	completed: 5,
	published: 5
};

// 旧 status 単一enumからフェーズを得る互換ヘルパー（移行期間中のみ使用）
export const statusToPhase = (status: DebateStatus): Phase => STATUS_PHASE_MAP[status] ?? 1;

// topic.phase（新モデル）を優先し、未設定なら旧 status から導出する互換ヘルパー
export const resolveCurrentPhase = (topic: { phase?: Phase; status: DebateStatus }): Phase =>
	topic.phase ?? statusToPhase(topic.status);

// (phase, phaseStatus) と対象フェーズ p、(フェーズ5のみ) session 終端情報から表示状態を導出する純粋関数
export const phaseLogicalState = (
	current: { phase: Phase; phaseStatus: PhaseStatus },
	target: Phase,
	hints?: { sessionStatus?: SessionStatus; debateComplete?: boolean; clientPhaseInFlight?: boolean }
): PhaseLogicalState => {
	if (target < current.phase) return 'approved';
	if (target > current.phase) return 'not_started';
	// target === current.phase
	if (current.phaseStatus !== 'running') return current.phaseStatus;
	// running の再調整（hints 未指定なら保守的に running のまま）
	if (!hints) return 'running';
	if (target === 5) {
		if (hints.sessionStatus === 'completed' || hints.debateComplete) return 'generated';
		if (hints.sessionStatus === 'cancelled') return 'stopped';
		return 'running';
	}
	// クライアント権威フェーズ(1〜4): inFlight でなければ中断とみなし not_started に戻す
	return hints.clientPhaseInFlight ? 'running' : 'not_started';
};

const LEGACY_PHASE_STATE: Record<DebateStatus, { phase: Phase; phaseStatus: PhaseStatus }> = {
	pending: { phase: 1, phaseStatus: 'not_started' },
	surveying: { phase: 1, phaseStatus: 'running' },
	generating_personas: { phase: 2, phaseStatus: 'running' },
	interviewing: { phase: 3, phaseStatus: 'running' },
	chapters_ready: { phase: 4, phaseStatus: 'generated' },
	chapters_approved: { phase: 5, phaseStatus: 'not_started' },
	debating: { phase: 5, phaseStatus: 'running' },
	cancelled: { phase: 5, phaseStatus: 'running' },
	completed: { phase: 5, phaseStatus: 'generated' },
	published: { phase: 5, phaseStatus: 'generated' }
};

// 旧 status を持つ既存トピックを新2軸へ遅延移行する互換関数
export const deriveLegacyPhaseState = (
	legacyStatus: string,
	hints?: {
		hasStakeholders: boolean;
		stakeholdersApproved: boolean;
		hasPersonas: boolean;
		allInterviewsDone: boolean;
		hasChapters: boolean;
		sessionStatus?: SessionStatus;
	}
): { phase: Phase; phaseStatus: PhaseStatus } => {
	const known = LEGACY_PHASE_STATE[legacyStatus as DebateStatus];
	if (known) return known;
	// 未知 status はサブコレクションのヒントから到達済みフェーズを再構築する
	if (hints) {
		if (hints.hasChapters) {
			if (hints.sessionStatus === 'completed') return { phase: 5, phaseStatus: 'generated' };
			if (hints.sessionStatus === 'cancelled' || hints.sessionStatus === 'debating')
				return { phase: 5, phaseStatus: 'running' };
			return { phase: 4, phaseStatus: 'generated' };
		}
		if (hints.allInterviewsDone) return { phase: 4, phaseStatus: 'not_started' };
		if (hints.hasPersonas) return { phase: 3, phaseStatus: 'not_started' };
		if (hints.stakeholdersApproved) return { phase: 2, phaseStatus: 'not_started' };
		if (hints.hasStakeholders) return { phase: 1, phaseStatus: 'generated' };
	}
	return { phase: 1, phaseStatus: 'not_started' };
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

// ダッシュボード一覧のバッジ用に (phase, phaseStatus) からラベル/スタイルキーを導出する
export const phaseDisplayLabel = (current: {
	phase: Phase;
	phaseStatus: PhaseStatus;
}): { label: string; styleKey: string } => {
	const { phase, phaseStatus } = current;
	if (phaseStatus === 'running') return { label: RUNNING_LABEL[phase], styleKey: 'running' };
	if (phaseStatus === 'generated')
		return { label: GENERATED_LABEL[phase], styleKey: phase === 5 ? 'completed' : 'ready' };
	return { label: NOT_STARTED_LABEL[phase], styleKey: 'pending' };
};
