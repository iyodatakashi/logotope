import type { PhaseSlug, PhaseStatus, PhaseLogicalState } from '$lib/models/phase/phase.types';
import { PHASE_DEFS } from '$lib/models/phase/phase.constants';

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

export const phasePath = (topicId: string, phase: PhaseSlug): string => {
	const phaseDefinition = PHASE_DEFS.find((entry) => entry.key === phase) ?? PHASE_DEFS[0];
	return `/admin/topics/${topicId}/${phaseDefinition.key}`;
};

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

// トピック状態 × 対象フェーズ → 編集可否。phaseLogicalState と同型の導出パターン。
// 公開画面（publish）は常に編集可（公開中にスイッチを OFF にできる必要がある）。
// それ以外のフェーズは非公開のときのみ編集可（公開中はコンテンツ変更操作を凍結する）。
export const phaseEditable = (current: { published: boolean }, target: PhaseSlug): boolean =>
	target === 'publish' ? true : !current.published;

// ダッシュボード一覧のバッジ用に (phase, phaseStatus, published) からラベル/スタイルキーを導出する。
// publish フェーズは可逆トグル（published）で完了を判定するため phaseStatus を参照しない。
export const phaseDisplayLabel = (current: {
	phase: PhaseSlug;
	phaseStatus: PhaseStatus;
	published: boolean;
}): { label: string; styleKey: string } => {
	const { phase, phaseStatus, published } = current;
	if (phase === 'publish')
		return published
			? { label: '公開中', styleKey: 'completed' }
			: { label: '未公開', styleKey: 'pending' };
	const phaseDefinition = PHASE_DEFS.find((entry) => entry.key === phase) ?? PHASE_DEFS[0];
	const label = phaseDefinition.statusLabels[phaseStatus];
	if (phaseStatus === 'running') return { label, styleKey: 'running' };
	if (phaseStatus === 'stopped') return { label, styleKey: 'stopped' };
	if (phaseStatus === 'generated') return { label, styleKey: 'ready' };
	return { label, styleKey: 'pending' };
};
