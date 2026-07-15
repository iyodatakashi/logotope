import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { requireAuth } from '../utils/auth.js';
import { fetchAndExtractText } from '../pipeline/topics/source-fetcher.js';

const db = () => getFirestore();

/**
 * 参考URLの本文を取得し、取得結果をトピックへ永続する onCall。名前は fetch だが取得だけでなく Firestore への
 * 書き込み（fetchedSourceContents）まで行う（現状維持＋根拠・R7.4: 取得結果を永続するのが本来の意図。取得と
 * 永続を分けず1操作で扱う設計）。取得失敗した URL は結果から除外する（best-effort）。
 */
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

	const fetchedSourceContents: { url: string; content: string; fetchedAt: Timestamp }[] = [];
	results.forEach((result, i) => {
		const content = result.status === 'fulfilled' ? result.value : null;
		if (content !== null) {
			fetchedSourceContents.push({ url: urls[i], content, fetchedAt: Timestamp.now() });
		} else {
			console.error(`Failed to fetch URL: ${urls[i]}`);
		}
	});

	await db().doc(`topics/${topicId}`).update({
		fetchedSourceContents,
		sourceContentsFetchedAt: FieldValue.serverTimestamp()
	});

	return { fetchedCount: fetchedSourceContents.length, totalCount: urls.length };
});
