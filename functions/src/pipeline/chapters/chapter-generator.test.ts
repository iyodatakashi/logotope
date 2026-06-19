import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ get: mockGet, set: mockSet, update: mockUpdate });

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	Timestamp: { now: vi.fn(() => 'mock-ts') },
}));

const mockGetTopicById = vi.fn();
vi.mock('../topics/topics.js', () => ({
	getTopicById: (...args: unknown[]) => mockGetTopicById(...args),
}));

const mockGetPersonasByTopicId = vi.fn();
vi.mock('../personas/personas.js', () => ({
	getPersonasByTopicId: (...args: unknown[]) => mockGetPersonasByTopicId(...args),
}));

const mockGenerateChapters = vi.fn();
vi.mock('../../agents/chapter-agent.js', () => ({
	generateChapters: (...args: unknown[]) => mockGenerateChapters(...args),
}));

import { planChapters } from './chapter-generator.js';
import type { Topic } from '../../types/topic.types.js';

const mockChaptersResult = {
	ok: true,
	value: {
		chapters: [{ id: 'c1', title: '第1章', focusQuestion: '問い', discussionPoints: [] }],
		generalIssues: ['issue1'],
		personaIssues: ['issue2'],
	},
};

describe('planChapters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGet.mockResolvedValue({ exists: false });
		mockGetPersonasByTopicId.mockResolvedValue([{ id: 'p1', approved: true }]);
		mockGenerateChapters.mockResolvedValue(mockChaptersResult);
	});

	it('トピックが存在しない場合はエラーをスローする', async () => {
		mockGetTopicById.mockResolvedValue(null);
		await expect(planChapters('nonexistent')).rejects.toThrow('Topic not found');
	});

	it('topicContextなしでgenerateChaptersを呼ぶ（後方互換）', async () => {
		const topic: Topic = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		expect(mockGenerateChapters).toHaveBeenCalledWith(
			'テーマ',
			expect.any(Array),
			undefined
		);
	});

	it('descriptionがあればtopicContextを組み立ててgenerateChaptersに渡す', async () => {
		const topic: Topic = {
			id: 'topic1',
			title: 'テーマ',
			description: 'テーマの詳細説明',
			createdAt: '',
			updatedAt: '',
		};
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		expect(mockGenerateChapters).toHaveBeenCalledWith(
			'テーマ',
			expect.any(Array),
			expect.objectContaining({ description: 'テーマの詳細説明' })
		);
	});

	it('fetchedSourceContentsがあればsourceContentsを組み立ててgenerateChaptersに渡す', async () => {
		const topic: Topic = {
			id: 'topic1',
			title: 'テーマ',
			fetchedSourceContents: [
				{ url: 'https://example.com', content: 'コンテンツ1', fetchedAt: '2026-01-01' },
			],
			createdAt: '',
			updatedAt: '',
		};
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		expect(mockGenerateChapters).toHaveBeenCalledWith(
			'テーマ',
			expect.any(Array),
			expect.objectContaining({ sourceContents: ['コンテンツ1'] })
		);
	});

	it('descriptionもfetchedSourceContentsもない場合はtopicContextをundefinedで渡す', async () => {
		const topic: Topic = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		expect(mockGenerateChapters).toHaveBeenCalledWith('テーマ', expect.any(Array), undefined);
	});
});
