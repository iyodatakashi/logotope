import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSet = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ set: mockSet, update: mockUpdate });

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
		chapters: [
			{ id: 'c1', title: '第1章', focusQuestion: '問い1', discussionPoints: ['論点A'] },
			{ id: 'c2', title: '第2章', focusQuestion: '問い2', discussionPoints: [] },
		],
		generalIssues: ['general1'],
		personaIssues: ['persona1'],
	},
};

describe('planChapters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetPersonasByTopicId.mockResolvedValue([{ id: 'p1', approved: true }]);
		mockGenerateChapters.mockResolvedValue(mockChaptersResult);
	});

	it('トピックが存在しない場合はエラーをスローする', async () => {
		mockGetTopicById.mockResolvedValue(null);
		await expect(planChapters('nonexistent')).rejects.toThrow('Topic not found');
	});

	it('各チャプターを chapters/{id} に status=pending・turns=[] で書き込む', async () => {
		const topic: Topic = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		expect(mockDoc).toHaveBeenCalledWith('topics/topic1/chapters/c1');
		const c1SetCall = mockSet.mock.calls.find((call) =>
			mockDoc.mock.calls.some((docCall, i) => docCall[0] === 'topics/topic1/chapters/c1' && mockSet === mockSet)
		);
		// chapterIndex, status=pending, turns=[] が含まれること
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ chapterIndex: 0, status: 'pending', turns: [] })
		);
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ chapterIndex: 1, status: 'pending', turns: [] })
		);
	});

	it('chapterAnalysis/0 に general・persona を書き込む', async () => {
		const topic: Topic = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		expect(mockDoc).toHaveBeenCalledWith('topics/topic1/chapterAnalysis/0');
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ general: ['general1'], persona: ['persona1'] })
		);
	});

	it('sessions/0 ドキュメントを作成・更新しない', async () => {
		const topic: Topic = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		const sessionDocCalls = mockDoc.mock.calls.filter((call: string[]) =>
			call[0]?.includes('sessions')
		);
		expect(sessionDocCalls).toHaveLength(0);
	});

	it('topicContextなしでgenerateChaptersを呼ぶ（後方互換）', async () => {
		const topic: Topic = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		expect(mockGenerateChapters).toHaveBeenCalledWith('テーマ', expect.any(Array), undefined);
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
});
