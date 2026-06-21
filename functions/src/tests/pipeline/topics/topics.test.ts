import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockDoc = vi.fn().mockReturnValue({ get: mockGet });

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	Timestamp: {
		now: vi.fn(() => ({ toDate: () => new Date('2026-01-01') }))
	}
}));

import { getTopicById } from '../../../pipeline/topics/topics.js';

describe('getTopicById', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('ドキュメントが存在しない場合はnullを返す', async () => {
		mockGet.mockResolvedValue({ exists: false });
		const result = await getTopicById('nonexistent');
		expect(result).toBeNull();
	});

	it('基本フィールドを返す', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			id: 'topic1',
			data: () => ({
				title: 'テストトピック',
				createdAt: { toDate: () => new Date('2026-01-01') },
				updatedAt: { toDate: () => new Date('2026-01-02') }
			})
		});

		const result = await getTopicById('topic1');
		expect(result).toMatchObject({
			id: 'topic1',
			title: 'テストトピック'
		});
	});

	it('descriptionフィールドを返す', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			id: 'topic1',
			data: () => ({
				title: 'テストトピック',
				description: 'テストの説明文',
				createdAt: { toDate: () => new Date('2026-01-01') },
				updatedAt: { toDate: () => new Date('2026-01-02') }
			})
		});

		const result = await getTopicById('topic1');
		expect(result?.description).toBe('テストの説明文');
	});

	it('sourceUrlsフィールドを返す', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			id: 'topic1',
			data: () => ({
				title: 'テストトピック',
				sourceUrls: ['https://example.com/1', 'https://example.com/2'],
				createdAt: { toDate: () => new Date('2026-01-01') },
				updatedAt: { toDate: () => new Date('2026-01-02') }
			})
		});

		const result = await getTopicById('topic1');
		expect(result?.sourceUrls).toEqual(['https://example.com/1', 'https://example.com/2']);
	});

	it('fetchedSourceContentsフィールドを返す', async () => {
		const mockContents = [
			{
				url: 'https://example.com/1',
				content: 'コンテンツ1',
				fetchedAt: '2026-01-01T00:00:00.000Z'
			}
		];
		mockGet.mockResolvedValue({
			exists: true,
			id: 'topic1',
			data: () => ({
				title: 'テストトピック',
				fetchedSourceContents: mockContents,
				createdAt: { toDate: () => new Date('2026-01-01') },
				updatedAt: { toDate: () => new Date('2026-01-02') }
			})
		});

		const result = await getTopicById('topic1');
		expect(result?.fetchedSourceContents).toEqual(mockContents);
	});

	it('新フィールドがなくても既存フィールドを正常に返す（後方互換）', async () => {
		mockGet.mockResolvedValue({
			exists: true,
			id: 'topic1',
			data: () => ({
				title: 'テストトピック',
				createdAt: { toDate: () => new Date('2026-01-01') },
				updatedAt: { toDate: () => new Date('2026-01-02') }
			})
		});

		const result = await getTopicById('topic1');
		expect(result?.description).toBeUndefined();
		expect(result?.sourceUrls).toBeUndefined();
		expect(result?.fetchedSourceContents).toBeUndefined();
	});
});
