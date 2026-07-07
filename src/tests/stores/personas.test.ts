import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBatch } = vi.hoisted(() => ({
	mockBatch: {
		update: vi.fn(),
		delete: vi.fn(),
		commit: vi.fn(() => Promise.resolve())
	}
}));

let snapshotCb: ((snap: unknown) => void) | null = null;
let topicDocData: Record<string, unknown> = {};

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
	getDoc: vi.fn().mockImplementation(() => Promise.resolve({ data: () => topicDocData })),
	updateDoc: vi.fn().mockResolvedValue(undefined),
	writeBatch: vi.fn(() => mockBatch),
	Timestamp: { now: vi.fn(() => 'NOW') }
}));

import { updateDoc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { createPersonasStore } from '$lib/stores/personas.svelte';

const TOPIC_PATH = { path: 'topics/t1' };

const populate = (store: ReturnType<typeof createPersonasStore>, ids: string[]) => {
	store.start();
	snapshotCb?.({
		docs: ids.map((id) => ({ id, data: () => ({ name: id, beliefs: [], approved: true }) }))
	});
};

describe('Timestamp→Date 変換', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		snapshotCb = null;
		topicDocData = {};
	});

	it('beliefs[].createdAt が Date に変換される', () => {
		const store = createPersonasStore('t1');
		store.start();
		const fakeDate = new Date('2026-01-01');
		snapshotCb?.({
			docs: [
				{
					id: 'p1',
					data: () => ({
						name: 'テスト',
						beliefs: [
							{ id: 'b1', version: 1, content: '信念', createdAt: { toDate: () => fakeDate } }
						],
						approved: true
					})
				}
			]
		});
		expect(store.personas[0].beliefs[0].createdAt).toBeInstanceOf(Date);
		expect(store.personas[0].beliefs[0].createdAt).toBe(fakeDate);
	});

	it('awarenesses[].createdAt が Date に変換される', () => {
		const store = createPersonasStore('t1');
		store.start();
		const fakeDate = new Date('2026-02-02');
		snapshotCb?.({
			docs: [
				{
					id: 'p1',
					data: () => ({
						name: 'テスト',
						beliefs: [],
						awarenesses: [
							{
								id: 'a1',
								kind: 'self',
								content: '気づき',
								sourcePersonaId: null,
								triggeredByTurnId: 't1',
								createdAt: { toDate: () => fakeDate }
							}
						],
						approved: true
					})
				}
			]
		});
		expect(store.personas[0].awarenesses?.[0].createdAt).toBeInstanceOf(Date);
		expect(store.personas[0].awarenesses?.[0].createdAt).toBe(fakeDate);
	});

	it('interview.completedAt が Date に変換される', () => {
		const store = createPersonasStore('t1');
		store.start();
		const fakeDate = new Date('2026-06-01');
		snapshotCb?.({
			docs: [
				{
					id: 'p1',
					data: () => ({
						name: 'テスト',
						beliefs: [],
						approved: true,
						interview: { status: 'completed', completedAt: { toDate: () => fakeDate } }
					})
				}
			]
		});
		expect(store.personas[0].interview?.completedAt).toBeInstanceOf(Date);
		expect(store.personas[0].interview?.completedAt).toBe(fakeDate);
	});

	it('interview.completedAt が undefined のとき undefined のまま', () => {
		const store = createPersonasStore('t1');
		store.start();
		snapshotCb?.({
			docs: [
				{
					id: 'p1',
					data: () => ({
						name: 'テスト',
						beliefs: [],
						approved: true,
						interview: { status: 'completed' }
					})
				}
			]
		});
		expect(store.personas[0].interview?.completedAt).toBeUndefined();
	});
});

describe('createPersonasStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		snapshotCb = null;
		topicDocData = {};
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
			expect.objectContaining({ phase: 'interviews', phaseStatus: 'not_started' })
		);
	});

	it('resetPersonas は全ペルソナを削除し (2, not_started) へ戻す', async () => {
		const store = createPersonasStore('t1');
		populate(store, ['p1']);
		await store.resetPersonas();

		expect(mockBatch.delete).toHaveBeenCalledWith({ path: 'topics/t1/personas/p1' });
		expect(mockBatch.update).toHaveBeenCalledWith(
			TOPIC_PATH,
			expect.objectContaining({ phase: 'personas', phaseStatus: 'not_started' })
		);
	});

	it('markInterviewsStarted は (3, running) を書き込む', async () => {
		const store = createPersonasStore('t1');
		await store.markInterviewsStarted();

		expect(updateDoc).toHaveBeenCalledWith(
			TOPIC_PATH,
			expect.objectContaining({ phase: 'interviews', phaseStatus: 'running' })
		);
	});

	it('markInterviewsComplete を公開しない（完了確定はサーバ権威）', () => {
		const store = createPersonasStore('t1');
		expect('markInterviewsComplete' in store).toBe(false);
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

	it('runInterview は開始時に前回の最終信念(beliefs)と中間データをクリアする', async () => {
		const mockFn = vi
			.fn()
			.mockResolvedValue({ data: { interviewRecord: '', belief: '', sources: [] } });
		vi.mocked(httpsCallable).mockReturnValue(mockFn as unknown as ReturnType<typeof httpsCallable>);

		const store = createPersonasStore('t1');
		populate(store, ['p1']);
		await store.runInterview('p1', 'テストテーマ');

		expect(updateDoc).toHaveBeenCalledWith(
			{ path: 'topics/t1/personas/p1' },
			{ interview: { status: 'in_progress' }, beliefs: [] }
		);
	});

	it('runInterviews の all=true で全ペルソナを取材する', async () => {
		const mockFn = vi
			.fn()
			.mockResolvedValue({ data: { researchSummary: '', interviewRecord: '', belief: '' } });
		vi.mocked(httpsCallable).mockReturnValue(mockFn as unknown as ReturnType<typeof httpsCallable>);

		const store = createPersonasStore('t1');
		populate(store, ['p1', 'p2']);

		await store.runInterviews('テストテーマ', true);

		expect(mockFn).toHaveBeenCalledTimes(2);
	});

	it('runInterview は topicId/personaId をペイロードに含める', async () => {
		const mockFn = vi.fn().mockResolvedValue({ data: {} });
		vi.mocked(httpsCallable).mockReturnValue(mockFn as unknown as ReturnType<typeof httpsCallable>);

		const store = createPersonasStore('t1');
		populate(store, ['p1']);
		await store.runInterview('p1', 'テストテーマ');

		expect(mockFn.mock.calls[0][0]).toMatchObject({ topicId: 't1', personaId: 'p1' });
	});

	it('runInterview は結果（completed/beliefs）を自書込せず in_progress クリアのみ行う（サーバ権威）', async () => {
		const mockFn = vi.fn().mockResolvedValue({
			data: { interviewRecord: 'r', belief: 'b', sources: [] }
		});
		vi.mocked(httpsCallable).mockReturnValue(mockFn as unknown as ReturnType<typeof httpsCallable>);

		const store = createPersonasStore('t1');
		populate(store, ['p1']);
		await store.runInterview('p1', 'テストテーマ');

		const personaWrites = vi
			.mocked(updateDoc)
			.mock.calls.filter((c) => (c[0] as { path: string }).path === 'topics/t1/personas/p1');
		expect(personaWrites).toHaveLength(1);
		expect(personaWrites[0][1]).toEqual({ interview: { status: 'in_progress' }, beliefs: [] });
	});

	it('runInterview は callable の reject を呼び出し元へ伝播する', async () => {
		const mockFn = vi.fn().mockRejectedValue(new Error('callable failed'));
		vi.mocked(httpsCallable).mockReturnValue(mockFn as unknown as ReturnType<typeof httpsCallable>);

		const store = createPersonasStore('t1');
		populate(store, ['p1']);

		await expect(store.runInterview('p1', 'テストテーマ')).rejects.toThrow('callable failed');
	});

	it('runInterviews は全成功時に generated/stopped を自書込しない（サーバ権威）', async () => {
		const mockFn = vi.fn().mockResolvedValue({ data: {} });
		vi.mocked(httpsCallable).mockReturnValue(mockFn as unknown as ReturnType<typeof httpsCallable>);

		const store = createPersonasStore('t1');
		populate(store, ['p1', 'p2']);
		await store.runInterviews('テストテーマ');

		const topicStatuses = vi
			.mocked(updateDoc)
			.mock.calls.filter((c) => (c[0] as { path: string }).path === 'topics/t1')
			.map((c) => (c[1] as { phaseStatus?: string }).phaseStatus);
		expect(topicStatuses).toEqual(['running']);
		expect(getDoc).not.toHaveBeenCalled();
	});

	it('runInterviews は rejected があればガード付きで stopped を書く（generated でないとき）', async () => {
		const mockFn = vi.fn().mockRejectedValue(new Error('failed'));
		vi.mocked(httpsCallable).mockReturnValue(mockFn as unknown as ReturnType<typeof httpsCallable>);

		const store = createPersonasStore('t1');
		populate(store, ['p1']);
		topicDocData = { phaseStatus: 'running' };

		await store.runInterviews('テストテーマ');

		expect(getDoc).toHaveBeenCalled();
		expect(updateDoc).toHaveBeenCalledWith(
			TOPIC_PATH,
			expect.objectContaining({ phaseStatus: 'stopped' })
		);
	});

	it('runInterviews は rejected があってもサーバが generated 済みなら stopped を書かない', async () => {
		const mockFn = vi.fn().mockRejectedValue(new Error('failed'));
		vi.mocked(httpsCallable).mockReturnValue(mockFn as unknown as ReturnType<typeof httpsCallable>);

		const store = createPersonasStore('t1');
		populate(store, ['p1']);
		topicDocData = { phaseStatus: 'generated' };

		await store.runInterviews('テストテーマ');

		const stoppedWrite = vi
			.mocked(updateDoc)
			.mock.calls.find((c) => (c[1] as { phaseStatus?: string }).phaseStatus === 'stopped');
		expect(stoppedWrite).toBeUndefined();
	});
});
