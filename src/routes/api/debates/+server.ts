import { json } from '@sveltejs/kit';
import { getPublishedDebates } from '$lib/server/dataconnect.js';
import type { PublishedDebateSummary } from '$lib/types/index.js';

export async function GET() {
	const sessions = await getPublishedDebates();

	const summaries: PublishedDebateSummary[] = sessions.map((s) => ({
		id: s.id,
		topicTitle: s.topic.title,
		personaCount: 0,
		publishedAt: s.publishedAt
	}));

	return json(summaries);
}
