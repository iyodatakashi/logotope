import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { requireAuth } from '../utils/auth.js';
import { fetchAndExtractText } from '../pipeline/topics/source-fetcher.js';

const db = () => getFirestore();

export const fetchSourceContents = onCall(async (request) => {
	requireAuth(request);
	const { topicId } = request.data as { topicId?: string };
	if (!topicId?.trim()) throw new HttpsError('invalid-argument', 'topicId is required');

	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) throw new HttpsError('not-found', `topic ${topicId} not found`);

	const data = snap.data() as { sourceUrls?: string[] };
	if (!data.sourceUrls?.length) throw new HttpsError('invalid-argument', 'topic has no sourceUrls');

	const urls = data.sourceUrls.slice(0, 5);
	const results = await Promise.allSettled(urls.map((url) => fetchAndExtractText(url)));

	const fetchedSourceContents: { url: string; content: string; fetchedAt: string }[] = [];
	results.forEach((result, i) => {
		const content = result.status === 'fulfilled' ? result.value : null;
		if (content !== null) {
			fetchedSourceContents.push({ url: urls[i], content, fetchedAt: new Date().toISOString() });
		} else {
			console.error(`Failed to fetch URL: ${urls[i]}`);
		}
	});

	await db().doc(`topics/${topicId}`).update({
		fetchedSourceContents,
		sourceContentsFetchedAt: FieldValue.serverTimestamp(),
	});

	return { fetchedCount: fetchedSourceContents.length, totalCount: urls.length };
});
