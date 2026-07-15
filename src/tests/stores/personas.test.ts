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
		docs: ids.map((id) => ({ id, data: () => ({ name: id, beliefs: [], selected: true }) }))
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
						selected: true
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
						selected: true
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
						selected: true,
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
						selected: true,
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

	it('setSelected は当該ペルソナのみ selected を更新する（安定 id キー）', async () => {
		const store = createPersonasStore('t1');
		populate(store, ['p1', 'p2']);

		await store.setSelected('p2', false);

		expect(updateDoc).toHaveBeenCalledTimes(1);
		expect(updateDoc).toHaveBeenCalledWith({ path: 'topics/t1/personas/p2' }, { selected: false });
	});

	it('reinterview は単一ペルソナの取材を実行する（in_progress クリア＋callable 呼び出し）', async () => {
		const mockFn = vi.fn().mockResolvedValue({ data: {} });
		vi.mocked(httpsCallable).mockReturnValue(mockFn as unknown as ReturnType<typeof httpsCallable>);

		const store = createPersonasStore('t1');
		populate(store, ['p1', 'p2']);

		await store.reinterview('p1', 'テストテーマ');

		expect(mockFn).toHaveBeenCalledTimes(1);
		expect(mockFn.mock.calls[0][0]).toMatchObject({ topicId: 't1', personaId: 'p1' });
		expect(updateDoc).toHaveBeenCalledWith(
			{ path: 'topics/t1/personas/p1' },
			{ interview: { status: 'in_progress' }, beliefs: [] }
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

	it('markInterviewsStarted は (personas, running) を書き込む（再取材前の running 復帰）', async () => {
		const store = createPersonasStore('t1');
		await store.markInterviewsStarted();

		expect(updateDoc).toHaveBeenCalledWith(
			TOPIC_PATH,
			expect.objectContaining({ phase: 'personas', phaseStatus: 'running' })
		);
	});

	it('markInterviewsComplete を公開しない（完了確定はサーバ権威）', () => {
		const store = createPersonasStore('t1');
		expect('markInterviewsComplete' in store).toBe(false);
	});

	it('撤去した承認・バッチ取材メソッドを公開しない', () => {
		const store = createPersonasStore('t1');
		expect('approvePersonas' in store).toBe(false);
		expect('runInterviews' in store).toBe(false);
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
});
