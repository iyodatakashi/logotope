import type { PublishedDebateSummary, PublishedDebateDetail } from '$lib/types/index.js';

export async function listDebates(): Promise<PublishedDebateSummary[]> {
	const res = await fetch('/api/debates');
	if (!res.ok) throw new Error(`listDebates failed: ${res.status}`);
	return res.json() as Promise<PublishedDebateSummary[]>;
}

export async function getDebate(id: string): Promise<PublishedDebateDetail> {
	const res = await fetch(`/api/debates/${id}`);
	if (!res.ok) throw new Error(`getDebate failed: ${res.status}`);
	return res.json() as Promise<PublishedDebateDetail>;
}
