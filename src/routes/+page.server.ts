import type { PageServerLoad } from './$types.js';
import type { PublishedDebateSummary } from '$lib/types/index.js';

export const load: PageServerLoad = async ({ fetch }) => {
	const res = await fetch('/api/debates');
	const debates: PublishedDebateSummary[] = res.ok ? await res.json() : [];
	return { debates };
};
