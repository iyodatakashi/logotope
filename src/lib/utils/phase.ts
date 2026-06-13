import type { DebateStatus } from '$lib/models/topic/topic.types.js';

export type Phase = 1 | 2 | 3 | 4 | 5;

export type PhaseSlug = 'stakeholders' | 'personas' | 'interviews' | 'chapters' | 'debate';

export interface PhaseDef {
	phase: Phase;
	slug: PhaseSlug;
	label: string;
}

export const PHASE_DEFS: readonly PhaseDef[] = [
	{ phase: 1, slug: 'stakeholders', label: 'ステークホルダー調査' },
	{ phase: 2, slug: 'personas', label: 'ペルソナ生成' },
	{ phase: 3, slug: 'interviews', label: '取材' },
	{ phase: 4, slug: 'chapters', label: '章立て' },
	{ phase: 5, slug: 'debate', label: '討論' }
];

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

export const statusToPhase = (status: DebateStatus): Phase => STATUS_PHASE_MAP[status] ?? 1;

export const phasePath = (topicId: string, phase: Phase): string => {
	const def = PHASE_DEFS.find((d) => d.phase === phase) ?? PHASE_DEFS[0];
	return `/admin/topics/${topicId}/${def.slug}`;
};
