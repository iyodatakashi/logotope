import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDelete = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({ update: mockUpdate, set: mockSet });

// collection ごとに異なる get を返すために path で分岐する
const mockChaptersGet = vi.fn();
const mockPersonasGet = vi.fn();
const mockEngagementsGet = vi.fn();

const mockCollection = vi.fn((path: string) => {
	if (path.match(/topics\/[^/]+\/chapters$/)) {
		return { orderBy: vi.fn().mockReturnValue({ get: mockChaptersGet }) };
	}
	if (path.endsWith('/personas')) {
		return { get: mockPersonasGet };
	}
	if (path.includes('/engagements')) {
		return { get: mockEngagementsGet };
	}
	return { get: vi.fn().mockResolvedValue({ docs: [] }) };
});

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc, collection: mockCollection })),
	Timestamp: { now: vi.fn(() => 'mock-ts') },
	FieldValue: {
		delete: vi.fn(() => 'DELETE_SENTINEL'),
		arrayUnion: vi.fn((...args: unknown[]) => args)
	}
}));

const mockClearEditedArtifact = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../pipeline/editing/edited-repository.js', () => ({
	clearEditedArtifact: mockClearEditedArtifact
}));

import {
	restartDebateFromChapter,
	resetDebate
} from '../../../pipeline/debate/debate-lifecycle.js';

const makeChapterDoc = (id: string, turns: { id: string }[] = []) => ({
	id,
	data: () => ({
		chapterIndex: 0,
		title: 'テスト章',
		turns,
		status: 'running'
	})
});

const makeEngagementDoc = (id: string) => ({
	id,
	ref: { delete: mockDelete },
	data: () => ({ history: {}, queuedIntents: [] })
});

describe('restartDebateFromChapter - チャプタースコープ engagements 削除', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPersonasGet.mockResolvedValue({ docs: [] });
	});

	it('廃棄チャプターの chapters/{chapterId}/engagements サブコレクションを参照する', async () => {
		mockChaptersGet.mockResolvedValue({
			docs: [makeChapterDoc('ch1', [{ id: 't1' }]), makeChapterDoc('ch2', [{ id: 't2' }])]
		});
		mockEngagementsGet.mockResolvedValue({ docs: [] });

		await restartDebateFromChapter('topic1', 'ch1');

		const engagementPaths = mockCollection.mock.calls
			.map((c: string[]) => c[0])
			.filter((p: string) => p.includes('/engagements'));

		// ch1 と ch2 の engagements サブコレクションが参照される
		expect(engagementPaths).toContain('topics/topic1/chapters/ch1/engagements');
		expect(engagementPaths).toContain('topics/topic1/chapters/ch2/engagements');
	});

	it('engagements ドキュメントが削除される', async () => {
		mockChaptersGet.mockResolvedValue({
			docs: [makeChapterDoc('ch1', [{ id: 't1' }])]
		});
		mockEngagementsGet.mockResolvedValue({
			docs: [makeEngagementDoc('persona1'), makeEngagementDoc('persona2')]
		});

		await restartDebateFromChapter('topic1', 'ch1');

		expect(mockDelete).toHaveBeenCalledTimes(2);
	});

	it('engagements ドキュメントが存在しない場合は delete を呼ばない', async () => {
		mockChaptersGet.mockResolvedValue({
			docs: [makeChapterDoc('ch1', [])]
		});
		mockEngagementsGet.mockResolvedValue({ docs: [] });

		await restartDebateFromChapter('topic1', 'ch1');

		expect(mockDelete).not.toHaveBeenCalled();
	});

	it('旧パス topics/{topicId}/engagements コレクションを参照しない', async () => {
		mockChaptersGet.mockResolvedValue({
			docs: [makeChapterDoc('ch1', [{ id: 't1' }])]
		});
		mockEngagementsGet.mockResolvedValue({ docs: [] });

		await restartDebateFromChapter('topic1', 'ch1');

		const allCollectionPaths = mockCollection.mock.calls.map((c: string[]) => c[0]);
		expect(allCollectionPaths).not.toContain('topics/topic1/engagements');
	});

	it('廃棄チャプターの quietStreak をリセット（削除）する', async () => {
		mockChaptersGet.mockResolvedValue({
			docs: [makeChapterDoc('ch1', [{ id: 't1' }])]
		});
		mockEngagementsGet.mockResolvedValue({ docs: [] });

		await restartDebateFromChapter('topic1', 'ch1');

		const chapterResetUpdate = mockUpdate.mock.calls.find(
			(c: unknown[]) => (c[0] as { turns?: unknown }).turns !== undefined
		);
		expect(chapterResetUpdate).toBeDefined();
		expect((chapterResetUpdate![0] as { quietStreak: unknown }).quietStreak).toBe(
			'DELETE_SENTINEL'
		);
	});

	it('破棄ターンに紐づく awareness を巻き戻す（triggeredByTurnId でフィルタ、初期信念は不変）', async () => {
		mockChaptersGet.mockResolvedValue({
			docs: [makeChapterDoc('ch1', [{ id: 't1' }])]
		});
		mockEngagementsGet.mockResolvedValue({ docs: [] });
		const personaRefUpdate = vi.fn().mockResolvedValue(undefined);
		mockPersonasGet.mockResolvedValue({
			docs: [
				{
					ref: { update: personaRefUpdate },
					data: () => ({
						beliefs: [{ id: 'b0', version: 0, content: '初期信念' }],
						awarenesses: [
							{ triggeredByTurnId: 't1', content: '破棄対象' },
							{ triggeredByTurnId: 't99', content: '残す' }
						]
					})
				}
			]
		});

		await restartDebateFromChapter('topic1', 'ch1');

		// awarenesses のみ triggeredByTurnId=t1 を除外して更新（beliefs には触れない）
		expect(personaRefUpdate).toHaveBeenCalledWith({
			awarenesses: [{ triggeredByTurnId: 't99', content: '残す' }]
		});
	});

	it('複数の廃棄チャプターそれぞれの engagements を削除する', async () => {
		mockChaptersGet.mockResolvedValue({
			docs: [
				makeChapterDoc('ch1', [{ id: 't1' }]),
				makeChapterDoc('ch2', [{ id: 't2' }]),
				makeChapterDoc('ch3', [{ id: 't3' }])
			]
		});
		// ch2 以降を廃棄（ch2 から restartDebateFromChapter）
		mockEngagementsGet.mockResolvedValue({ docs: [makeEngagementDoc('p1')] });

		await restartDebateFromChapter('topic1', 'ch2');

		const engagementPaths = mockCollection.mock.calls
			.map((c: string[]) => c[0])
			.filter((p: string) => p.includes('/engagements'));

		expect(engagementPaths).toContain('topics/topic1/chapters/ch2/engagements');
		expect(engagementPaths).toContain('topics/topic1/chapters/ch3/engagements');
		expect(engagementPaths).not.toContain('topics/topic1/chapters/ch1/engagements');
	});
});

describe('編集成果物の破棄（reset/restart 整合）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPersonasGet.mockResolvedValue({ docs: [] });
		mockEngagementsGet.mockResolvedValue({ docs: [] });
	});

	it('restartDebateFromChapter は編集成果物を破棄する', async () => {
		mockChaptersGet.mockResolvedValue({
			docs: [makeChapterDoc('ch1', [{ id: 't1' }])]
		});

		await restartDebateFromChapter('topic1', 'ch1');

		expect(mockClearEditedArtifact).toHaveBeenCalledWith('topic1');
	});

	it('resetDebate は編集成果物を破棄する', async () => {
		mockChaptersGet.mockResolvedValue({
			docs: [makeChapterDoc('ch1', [{ id: 't1' }])]
		});

		await resetDebate('topic1');

		expect(mockClearEditedArtifact).toHaveBeenCalledWith('topic1');
	});
});

describe('resetDebate - 全章リセット（サーバ集約）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPersonasGet.mockResolvedValue({ docs: [] });
		mockEngagementsGet.mockResolvedValue({ docs: [] });
	});

	it('phaseStatus を running にしない（開始は呼び出し側に委ねる）', async () => {
		mockChaptersGet.mockResolvedValue({
			docs: [makeChapterDoc('ch1', [{ id: 't1' }])]
		});

		await resetDebate('topic1');

		const setRunning = mockUpdate.mock.calls.find(
			(c: unknown[]) => (c[0] as { phaseStatus?: string }).phaseStatus !== undefined
		);
		expect(setRunning).toBeUndefined();
	});

	it('チャプターがなければ何もしない', async () => {
		mockChaptersGet.mockResolvedValue({ docs: [] });

		await resetDebate('topic1');

		expect(mockClearEditedArtifact).not.toHaveBeenCalled();
	});
});
