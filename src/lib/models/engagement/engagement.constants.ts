import type { EngagementLevel } from '$lib/models/topic/topic.types';

type EngagementStyle = {
	label: string;
	color: string;
	bg: string;
};

const STYLES: Record<EngagementLevel, EngagementStyle> = {
	high: { label: '専門・意識 高', color: '#b71c1c', bg: '#ffebee' },
	medium: { label: '専門・意識 中', color: '#e65100', bg: '#fff3e0' },
	low: { label: '専門・意識 低', color: '#37474f', bg: '#eceff1' }
};

const FALLBACK: EngagementStyle = { label: '専門・意識 不明', color: '#757575', bg: '#f5f5f5' };

export const engagementStyle = (level?: string): EngagementStyle =>
	level && level in STYLES ? STYLES[level as EngagementLevel] : FALLBACK;
