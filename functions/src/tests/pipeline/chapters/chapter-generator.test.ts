import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSet = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ set: mockSet, update: mockUpdate, delete: mockDelete });

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	Timestamp: { now: vi.fn(() => 'mock-ts') }
}));

const mockGetTopicById = vi.fn();
vi.mock('../../../pipeline/topics/topics.js', () => ({
	getTopicById: (...args: unknown[]) => mockGetTopicById(...args)
}));

const mockGetTopicContext = vi.fn();
vi.mock('../../../pipeline/topics/topic-context.js', () => ({
	getTopicContext: (...args: unknown[]) => mockGetTopicContext(...args)
}));

const mockGetPersonasByTopicId = vi.fn();
vi.mock('../../../pipeline/personas/personas.js', () => ({
	getPersonasByTopicId: (...args: unknown[]) => mockGetPersonasByTopicId(...args)
}));

const mockGenerateChapters = vi.fn();
vi.mock('../../../agents/chapter-agent.js', () => ({
	generateChapters: (...args: unknown[]) => mockGenerateChapters(...args)
}));

import { planChapters } from '../../../pipeline/chapters/chapter-generator.js';
import type { TopicForFirestore } from '../../../types/topic.types.js';

const mockChapters = [
	{ id: 'c1', title: '第1章', agenda: ['論点A'] },
	{ id: 'c2', title: '第2章', agenda: [] }
];

const mockChaptersResult = {
	ok: true,
	value: mockChapters
};

const makeGenerateChaptersMock = () =>
	vi.fn().mockImplementation(
		async (
			_title: unknown,
			_personas: unknown,
			_context: unknown,
			onProgress?: (p: {
				step: string;
				issues?: Array<{
					text: string;
					source: string;
					score?: number;
					reason?: string;
					selected?: boolean;
				}>;
				issueGroups?: Array<{ issueIndexes: number[] }>;
			}) => Promise<void>
		) => {
			if (onProgress) {
				await onProgress({
					step: 'issues_generated',
					issues: [
						{ text: 'general1', source: 'general' },
						{ text: 'persona1', source: 'persona' }
					]
				});
				await onProgress({
					step: 'issues_scored',
					issues: [
						{ text: 'general1', source: 'general', score: 8, reason: '良い', selected: true },
						{ text: 'persona1', source: 'persona', score: 7, reason: '良い', selected: true }
					]
				});
				await onProgress({
					step: 'issues_grouped',
					issueGroups: [{ issueIndexes: [0] }, { issueIndexes: [1] }]
				});
			}
			return mockChaptersResult;
		}
	);

describe('planChapters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDoc.mockReturnValue({ set: mockSet, update: mockUpdate, delete: mockDelete });
		mockGetPersonasByTopicId.mockResolvedValue([{ id: 'p1', approved: true }]);
		mockGetTopicContext.mockResolvedValue({});
		mockGenerateChapters.mockImplementation(makeGenerateChaptersMock());
	});

	it('トピックが存在しない場合はエラーをスローする', async () => {
		mockGetTopicById.mockResolvedValue(null);
		await expect(planChapters('nonexistent')).rejects.toThrow('Topic not found');
	});

	it('issues_generated イベントで chapterAnalysis/0 に issues を set する', async () => {
		const topic: TopicForFirestore = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		expect(mockDoc).toHaveBeenCalledWith('topics/topic1/chapterAnalysis/0');
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({
				issues: expect.arrayContaining([
					expect.objectContaining({ text: 'general1', source: 'general' }),
					expect.objectContaining({ text: 'persona1', source: 'persona' })
				])
			})
		);
		// score は issues_generated 時点では含まれない
		const setCallArgs = mockSet.mock.calls.find(
			(call: unknown[]) =>
				typeof call[0] === 'object' &&
				call[0] !== null &&
				'issues' in (call[0] as object) &&
				!(call[0] as { issues: unknown[] }).issues.some(
					(i: unknown) => (i as { score?: unknown }).score !== undefined
				)
		);
		expect(setCallArgs).toBeDefined();
	});

	it('issues_scored イベントで chapterAnalysis/0 の issues を update する', async () => {
		const topic: TopicForFirestore = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		expect(mockUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				issues: expect.arrayContaining([
					expect.objectContaining({ score: 8, reason: '良い', selected: true })
				])
			})
		);
	});

	it('issues_grouped イベントで chapterAnalysis/0 の issueGroups を update する', async () => {
		const topic: TopicForFirestore = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		expect(mockUpdate).toHaveBeenCalledWith({
			issueGroups: [{ issueIndexes: [0] }, { issueIndexes: [1] }]
		});
	});

	it('章生成完了後に chapters コレクションに各章を chapterIndex 付きで set する', async () => {
		const topic: TopicForFirestore = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		expect(mockDoc).toHaveBeenCalledWith('topics/topic1/chapters/c1');
		expect(mockDoc).toHaveBeenCalledWith('topics/topic1/chapters/c2');
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ chapterIndex: 0, title: '第1章', status: 'pending', turns: [] })
		);
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ chapterIndex: 1, title: '第2章', status: 'pending', turns: [] })
		);
	});

	it('sessions/0 ドキュメントを作成・更新しない', async () => {
		const topic: TopicForFirestore = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		const sessionDocCalls = mockDoc.mock.calls.filter((call: string[]) =>
			call[0]?.includes('sessions')
		);
		expect(sessionDocCalls).toHaveLength(0);
	});

	it('getTopicContext の結果（空）をそのまま generateChapters に渡す（後方互換）', async () => {
		const topic: TopicForFirestore = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);
		mockGetTopicContext.mockResolvedValue({});

		await planChapters('topic1');

		expect(mockGenerateChapters).toHaveBeenCalledWith(
			'テーマ',
			expect.any(Array),
			{},
			expect.any(Function)
		);
	});

	it('BE 権威経路 getTopicContext で合成した共有コンテキスト（説明・事実基盤）を generateChapters に渡す', async () => {
		const topic: TopicForFirestore = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);
		mockGetTopicContext.mockResolvedValue({
			description: 'テーマの詳細説明',
			factBase: {
				facts: [{ statement: '確定事実', sources: [] }],
				generatedAt: new Date('2026-07-03T00:00:00Z')
			}
		});

		await planChapters('topic1');

		expect(mockGetTopicContext).toHaveBeenCalledWith('topic1');
		expect(mockGenerateChapters).toHaveBeenCalledWith(
			'テーマ',
			expect.any(Array),
			expect.objectContaining({
				description: 'テーマの詳細説明',
				factBase: expect.objectContaining({ facts: [{ statement: '確定事実', sources: [] }] })
			}),
			expect.any(Function)
		);
	});

	it('generateChapters 失敗時は error メッセージを throw する', async () => {
		const topic: TopicForFirestore = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);
		mockGenerateChapters.mockResolvedValue({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'AI失敗', retryable: true }
		});

		await expect(planChapters('topic1')).rejects.toThrow('AI失敗');
	});

	it('プレースホルダー削除・件数不一致フォールバックが廃止されている（delete が呼ばれない）', async () => {
		const topic: TopicForFirestore = { id: 'topic1', title: 'テーマ', createdAt: '', updatedAt: '' };
		mockGetTopicById.mockResolvedValue(topic);

		await planChapters('topic1');

		expect(mockDelete).not.toHaveBeenCalled();
	});
});
