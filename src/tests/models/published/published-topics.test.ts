import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/firebase-public.js', () => ({ publicDb: {} }));

vi.mock('firebase/firestore', () => ({
	collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
	query: vi.fn((...args: unknown[]) => ({ args })),
	where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
	getDocs: vi.fn()
}));

import { collection, where, getDocs } from 'firebase/firestore';
import { fetchPublishedTopics } from '$lib/models/published/published-topic/published-topics';

const makeTimestamp = (date: Date) => ({ toDate: () => date });
const makeDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
const mockDocs = (docs: unknown[]) =>
	vi.mocked(getDocs).mockResolvedValue({ docs } as unknown as Awaited<ReturnType<typeof getDocs>>);

describe('fetchPublishedTopics', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('published == true の限定クエリで getDocs を呼ぶ', async () => {
		mockDocs([]);
		await fetchPublishedTopics();
		expect(collection).toHaveBeenCalledWith(expect.anything(), 'topics');
		expect(where).toHaveBeenCalledWith('published', '==', true);
		expect(getDocs).toHaveBeenCalledTimes(1);
	});

	it('publishedAt の新しい順に並べる', async () => {
		mockDocs([
			makeDoc('old', { title: 'old', published: true, publishedAt: makeTimestamp(new Date(2026, 0, 1)) }),
			makeDoc('new', { title: 'new', published: true, publishedAt: makeTimestamp(new Date(2026, 5, 1)) }),
			makeDoc('mid', { title: 'mid', published: true, publishedAt: makeTimestamp(new Date(2026, 2, 1)) })
		]);
		const topics = await fetchPublishedTopics();
		expect(topics.map((topic) => topic.id)).toEqual(['new', 'mid', 'old']);
	});

	it('PublishedTopic に射影し published/personaCount を含めない', async () => {
		mockDocs([
			makeDoc('t1', {
				title: 'タイトル',
				published: true,
				personaCount: 5,
				publishedAt: makeTimestamp(new Date(2026, 0, 1))
			})
		]);
		const [topic] = await fetchPublishedTopics();
		expect(topic).toEqual({ id: 't1', title: 'タイトル', publishedAt: new Date(2026, 0, 1) });
		expect(topic).not.toHaveProperty('published');
		expect(topic).not.toHaveProperty('personaCount');
	});

	it('Timestamp を Date に変換する', async () => {
		const date = new Date(2026, 3, 15);
		mockDocs([makeDoc('t1', { title: 't', published: true, publishedAt: makeTimestamp(date) })]);
		const [topic] = await fetchPublishedTopics();
		expect(topic.publishedAt).toBeInstanceOf(Date);
		expect(topic.publishedAt).toEqual(date);
	});

	it('publishedAt 欠落のドキュメントは除外する', async () => {
		mockDocs([
			makeDoc('no-date', { title: 'x', published: true }),
			makeDoc('ok', { title: 'ok', published: true, publishedAt: makeTimestamp(new Date(2026, 0, 1)) })
		]);
		const topics = await fetchPublishedTopics();
		expect(topics.map((topic) => topic.id)).toEqual(['ok']);
	});
});
