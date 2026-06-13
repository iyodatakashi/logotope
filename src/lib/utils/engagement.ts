import type { EngagementLevel } from '$lib/models/topic/topic.types.js';

type EngagementStyle = {
	label: string;
	color: string;
	bg: string;
};

const STYLES: Record<EngagementLevel, EngagementStyle> = {
	high: { label: '関与度 高', color: '#b71c1c', bg: '#ffebee' },
	medium: { label: '関与度 中', color: '#e65100', bg: '#fff3e0' },
	low: { label: '関与度 低', color: '#37474f', bg: '#eceff1' }
};

const FALLBACK: EngagementStyle = { label: '関与度 不明', color: '#757575', bg: '#f5f5f5' };

export const engagementStyle = (level?: string): EngagementStyle =>
	level && level in STYLES ? STYLES[level as EngagementLevel] : FALLBACK;
