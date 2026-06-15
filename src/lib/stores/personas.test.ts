import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBatch } = vi.hoisted(() => ({
	mockBatch: {
		update: vi.fn(),
		delete: vi.fn(),
		commit: vi.fn(() => Promise.resolve())
	}
}));

let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('$lib/firebase.js', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
	httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: {} }))
}));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn((_q: unknown, cb: (snap: unknown) => void) => {
		snapshotCb = cb;
		return () => {};
	}),
	collection: vi.fn(),
	query: vi.fn(),
	orderBy: vi.fn(),
	doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
	updateDoc: vi.fn().mockResolvedValue(undefined),
	writeBatch: vi.fn(() => mockBatch),
	Timestamp: { now: vi.fn(() => 'NOW') }
}));

import { updateDoc } from 'firebase/firestore';
import { createPersonasStore } from './personas.svelte';

const TOPIC_PATH = { path: 'topics/t1' };

const populate = (store: ReturnType<typeof createPersonasStore>, ids: string[]) => {
	store.start();
	snapshotCb?.({ docs: ids.map((id) => ({ id, data: () => ({ name: id }) })) });
};

describe('createPersonasStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		snapshotCb = null;
	});

	it('approvePersonas は全ペルソナを承認し (3, not_started) へ前進する', async () => {
		const store = createPersonasStore('t1');
		populate(store, ['p1', 'p2']);
		await store.approvePersonas();

		expect(mockBatch.update).toHaveBeenCalledWith(
			{ path: 'topics/t1/personas/p1' },
			{ approved: true }
		);
		expect(mockBatch.update).toHaveBeenCalledWith(
			TOPIC_PATH,
			expect.objectContaining({ phase: 3, phaseStatus: 'not_started' })
		);
	});

	it('resetPersonas は全ペルソナを削除し (2, not_started) へ戻す', async () => {
		const store = createPersonasStore('t1');
		populate(store, ['p1']);
		await store.resetPersonas();

		expect(mockBatch.delete).toHaveBeenCalledWith({ path: 'topics/t1/personas/p1' });
		expect(mockBatch.update).toHaveBeenCalledWith(
			TOPIC_PATH,
			expect.objectContaining({ phase: 2, phaseStatus: 'not_started' })
		);
	});

	it('markInterviewsStarted は (3, running) を書き込む', async () => {
		const store = createPersonasStore('t1');
		await store.markInterviewsStarted();

		expect(updateDoc).toHaveBeenCalledWith(
			TOPIC_PATH,
			expect.objectContaining({ phase: 3, phaseStatus: 'running' })
		);
	});

	it('markInterviewsComplete は (3, generated) を1回書き込む', async () => {
		const store = createPersonasStore('t1');
		await store.markInterviewsComplete();

		expect(updateDoc).toHaveBeenCalledWith(
			TOPIC_PATH,
			expect.objectContaining({ phase: 3, phaseStatus: 'generated' })
		);
	});

	it('承認・リセットは旧 status を書き込まない', async () => {
		const store = createPersonasStore('t1');
		populate(store, ['p1']);
		await store.approvePersonas();
		const topicUpdate = mockBatch.update.mock.calls.find(
			(c) => (c[0] as { path: string }).path === 'topics/t1'
		);
		expect(topicUpdate?.[1]).not.toHaveProperty('status');
	});
});
