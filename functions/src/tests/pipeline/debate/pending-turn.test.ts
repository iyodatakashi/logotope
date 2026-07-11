import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PendingTurn } from '../../../types/chapter.types.js';

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();
const mockRunTransaction = vi.fn(
	async (fn: (tx: { get: typeof mockTxGet; update: typeof mockTxUpdate }) => Promise<unknown>) =>
		fn({ get: mockTxGet, update: mockTxUpdate })
);
const mockDoc = vi.fn((path: string) => ({ path, update: mockUpdate }));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc, runTransaction: mockRunTransaction })),
	FieldValue: { delete: vi.fn(() => 'DELETE') }
}));

import {
	setPendingTurn,
	updatePendingTurnStatus,
	clearPendingTurn
} from '../../../pipeline/debate/pending-turn.js';

let txPending: PendingTurn | undefined;

const setupTx = () => {
	mockTxGet.mockImplementation(async () => ({ data: () => ({ pendingTurn: txPending }) }));
};

const generating: PendingTurn = {
	id: 'p1',
	personaId: 'per1',
	expectedTurnIndex: 2,
	status: 'generating'
};

beforeEach(() => {
	vi.clearAllMocks();
	txPending = undefined;
	setupTx();
});

describe('setPendingTurn', () => {
	it('chapter.pendingTurn を generating で書き込む（2.1）', async () => {
		await setPendingTurn({ topicId: 't1', chapterId: 'ch1', pendingTurn: generating });
		expect(mockDoc.mock.calls[0][0]).toBe('topics/t1/chapters/ch1');
		expect(mockUpdate).toHaveBeenCalledWith({ pendingTurn: generating });
	});
});

describe('updatePendingTurnStatus', () => {
	it('自 id と一致すれば status を fact-checking に更新する（2.2）', async () => {
		txPending = generating;
		await updatePendingTurnStatus({
			topicId: 't1',
			chapterId: 'ch1',
			id: 'p1',
			status: 'fact-checking'
		});
		expect(mockTxUpdate).toHaveBeenCalledWith(expect.anything(), {
			pendingTurn: { ...generating, status: 'fact-checking' }
		});
	});

	it('id が一致しなければ更新しない（後続 frontier の pendingTurn を誤更新しない）', async () => {
		txPending = { id: 'other', personaId: 'per1', expectedTurnIndex: 3, status: 'generating' };
		await updatePendingTurnStatus({
			topicId: 't1',
			chapterId: 'ch1',
			id: 'p1',
			status: 'fact-checking'
		});
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('pendingTurn が無ければ何もしない', async () => {
		txPending = undefined;
		await updatePendingTurnStatus({
			topicId: 't1',
			chapterId: 'ch1',
			id: 'p1',
			status: 'fact-checking'
		});
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});
});

describe('clearPendingTurn', () => {
	it('自 id と一致すれば pendingTurn を削除する（compare-and-clear・3.4/3.5/3.6）', async () => {
		txPending = { ...generating, status: 'fact-checking' };
		await clearPendingTurn({ topicId: 't1', chapterId: 'ch1', id: 'p1' });
		expect(mockTxUpdate).toHaveBeenCalledWith(expect.anything(), { pendingTurn: 'DELETE' });
	});

	it('id が一致しなければ削除しない（後続 frontier の正当な pendingTurn を誤消去しない・3.6）', async () => {
		txPending = { id: 'other', personaId: 'per1', expectedTurnIndex: 3, status: 'generating' };
		await clearPendingTurn({ topicId: 't1', chapterId: 'ch1', id: 'p1' });
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});

	it('pendingTurn が無ければ何もしない', async () => {
		txPending = undefined;
		await clearPendingTurn({ topicId: 't1', chapterId: 'ch1', id: 'p1' });
		expect(mockTxUpdate).not.toHaveBeenCalled();
	});
});
