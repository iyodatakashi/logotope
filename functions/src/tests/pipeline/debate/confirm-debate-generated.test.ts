import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();
const mockRunTransaction = vi.fn(
	async (fn: (tx: { get: typeof mockTxGet; update: typeof mockTxUpdate }) => Promise<unknown>) =>
		fn({ get: mockTxGet, update: mockTxUpdate })
);
const mockDoc = vi.fn((path: string) => ({ path }));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc, runTransaction: mockRunTransaction })),
	Timestamp: { now: vi.fn(() => 'mock-ts') }
}));

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'mock-run-id') }));

// discardChaptersWithSideData 経路の依存はここでは使わないため軽量スタブ
vi.mock('../../../pipeline/debate/chapter.js', () => ({
	discardChaptersFrom: vi.fn(),
	getChaptersByTopicId: vi.fn()
}));
vi.mock('../../../pipeline/debate/awareness.js', () => ({
	rollbackAwarenessesForRemovedTurns: vi.fn()
}));
vi.mock('../../../pipeline/debate/engagement.js', () => ({
	deleteChapterEngagements: vi.fn()
}));
vi.mock('../../../pipeline/editing/edited-repository.js', () => ({
	clearEditedArtifact: vi.fn()
}));

import { confirmDebateGenerated } from '../../../pipeline/debate/debate-lifecycle.js';

const setTopicData = (data: Record<string, unknown> | null) => {
	mockTxGet.mockResolvedValue(
		data === null ? { exists: false, data: () => undefined } : { exists: true, data: () => data }
	);
};

describe('confirmDebateGenerated', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('phase=debate かつ phaseStatus=running のとき generated へ遷移し true を返す', async () => {
		setTopicData({ phase: 'debate', phaseStatus: 'running' });

		const result = await confirmDebateGenerated('topic1');

		expect(result).toBe(true);
		expect(mockTxUpdate).toHaveBeenCalledWith(
			{ path: 'topics/topic1' },
			{ phase: 'debate', phaseStatus: 'generated', updatedAt: 'mock-ts' }
		);
	});

	it('phaseStatus=stopped のとき遷移せず false を返す（running 限定で停止済み討論の誤復活を塞ぐ）', async () => {
		setTopicData({ phase: 'debate', phaseStatus: 'stopped' });

		const result = await confirmDebateGenerated('topic1');

		expect(result).toBe(false);
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('phase が debate から前進済み（editing）のとき巻き戻さず false を返す', async () => {
		setTopicData({ phase: 'editing', phaseStatus: 'running' });

		const result = await confirmDebateGenerated('topic1');

		expect(result).toBe(false);
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('既に generated のとき遷移せず false を返す（冪等）', async () => {
		setTopicData({ phase: 'debate', phaseStatus: 'generated' });

		const result = await confirmDebateGenerated('topic1');

		expect(result).toBe(false);
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('ドキュメント不在のとき no-op で false を返す', async () => {
		setTopicData(null);

		const result = await confirmDebateGenerated('topic1');

		expect(result).toBe(false);
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});
});
