import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
import type { PublishedDebateDetail } from '$lib/types/index.js';

export const load: PageServerLoad = async ({ fetch, params }) => {
	const res = await fetch(`/api/debates/${params.id}`);
	if (res.status === 404) {
		error(404, 'Debate not found');
	}
	if (!res.ok) {
		error(500, 'Failed to load debate');
	}
	const debate: PublishedDebateDetail = await res.json();
	return { debate };
};
