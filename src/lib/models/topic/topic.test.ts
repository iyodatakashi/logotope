import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBatch } = vi.hoisted(() => ({
	mockBatch: {
		update: vi.fn(),
		delete: vi.fn(),
		set: vi.fn(),
		commit: vi.fn(() => Promise.resolve())
	}
}));

vi.mock('$lib/firebase.js', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
	httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: {} }))
}));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn(),
	doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
	updateDoc: vi.fn().mockResolvedValue(undefined),
	deleteDoc: vi.fn().mockResolvedValue(undefined),
	setDoc: vi.fn().mockResolvedValue(undefined),
	addDoc: vi.fn(() => Promise.resolve({ id: 'new' })),
	writeBatch: vi.fn(() => mockBatch),
	Timestamp: { now: vi.fn(() => 'NOW') },
	getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
	collection: vi.fn(),
	deleteField: vi.fn(() => 'DELETE_FIELD'),
	getDoc: vi.fn()
}));

import { httpsCallable } from 'firebase/functions';
import { updateDoc, deleteDoc, getDoc, getDocs } from 'firebase/firestore';
import { createTopicStore } from './topic.svelte.js';

const TOPIC_PATH = { path: 'topics/t1' };
const updateCallsFor = (path: string) =>
	vi.mocked(updateDoc).mock.calls.filter((c) => (c[0] as { path: string }).path === path);

describe('createTopicStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDoc).mockResolvedValue({ exists: () => false, data: () => undefined } as never);
		vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);
	});

	describe('承認操作の2軸遷移 (task 3.1)', () => {
		it('approveStakeholders は (2, not_started) へ前進しステークホルダーを承認する', async () => {
			const store = createTopicStore({ id: 't1' } as never);
			await store.approveStakeholders();
			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({
					'stakeholders.approved': true,
					phase: 2,
					phaseStatus: 'not_started'
				})
			);
		});

		it('approveInterviews は (4, not_started) へ前進する', async () => {
			const store = createTopicStore({ id: 't1' } as never);
			await store.approveInterviews();
			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({ phase: 4, phaseStatus: 'not_started' })
			);
		});

		it('approveChapters は (5, not_started) へ前進する', async () => {
			const store = createTopicStore({ id: 't1' } as never);
			await store.approveChapters();
			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({ phase: 5, phaseStatus: 'not_started' })
			);
		});

		it('承認操作は旧 status を書き込まない', async () => {
			const store = createTopicStore({ id: 't1' } as never);
			await store.approveChapters();
			const call = vi.mocked(updateDoc).mock.calls.at(-1)?.[1] as unknown as Record<
				string,
				unknown
			>;
			expect(call).not.toHaveProperty('status');
		});
	});

	describe('生成・再生成の2軸遷移と下流削除 (task 3.1)', () => {
		it('generateStakeholders は (1, running)→開始時に下流削除→生成成功で (1, generated)', async () => {
			vi.mocked(httpsCallable).mockReturnValue(
				vi.fn().mockResolvedValue({ data: { stakeholders: [{ role: 'A' }] } }) as never
			);
			const store = createTopicStore({ id: 't1', title: 'T' } as never);
			await store.generateStakeholders();

			const calls = updateCallsFor('topics/t1');
			// 生成開始でまず running を書く
			expect(calls[0][1]).toEqual(expect.objectContaining({ phase: 1, phaseStatus: 'running' }));
			// 開始時に下流（session・ペルソナ）を batch 削除する
			expect(mockBatch.delete).toHaveBeenCalledWith({ path: 'topics/t1/sessions/0' });
			expect(mockBatch.commit).toHaveBeenCalled();
			// 生成成功後に stakeholders + generated を書く
			expect(calls.at(-1)?.[1]).toEqual(
				expect.objectContaining({ phase: 1, phaseStatus: 'generated' })
			);
		});

		it('generateStakeholders は生成（fn 呼び出し）より前に下流を削除する', async () => {
			const order: string[] = [];
			vi.mocked(httpsCallable).mockReturnValue(
				vi.fn(async () => {
					order.push('generate');
					return { data: { stakeholders: [] } };
				}) as never
			);
			vi.mocked(getDocs).mockImplementation((async () => {
				order.push('getPersonas');
				return { docs: [] };
			}) as never);
			const store = createTopicStore({ id: 't1', title: 'T' } as never);
			await store.generateStakeholders();
			expect(order).toEqual(['getPersonas', 'generate']);
		});

		it('generatePersonas は (2, running)→生成成功後に (2, generated)', async () => {
			vi.mocked(httpsCallable).mockReturnValue(
				vi.fn().mockResolvedValue({ data: { personas: [{ name: 'p' }] } }) as never
			);
			const store = createTopicStore({ id: 't1', title: 'T' } as never);
			await store.generatePersonas();
			const calls = updateCallsFor('topics/t1');
			expect(calls[0][1]).toEqual(expect.objectContaining({ phase: 2, phaseStatus: 'running' }));
			expect(calls.at(-1)?.[1]).toEqual(
				expect.objectContaining({ phase: 2, phaseStatus: 'generated' })
			);
		});

		it('generateChapters は (4, running)→生成成功後に (4, generated)', async () => {
			const store = createTopicStore({ id: 't1', title: 'T' } as never);
			await store.generateChapters();
			const calls = updateCallsFor('topics/t1');
			expect(calls[0][1]).toEqual(expect.objectContaining({ phase: 4, phaseStatus: 'running' }));
			expect(calls.at(-1)?.[1]).toEqual(
				expect.objectContaining({ phase: 4, phaseStatus: 'generated' })
			);
		});
	});

	describe('regenerateDebate (task 3.1)', () => {
		it('討論ターンを初期化して（session に status を書かず）startDebate を呼ぶ', async () => {
			const mockStartFn = vi.fn().mockResolvedValue({ data: {} });
			vi.mocked(httpsCallable).mockReturnValue(mockStartFn as never);

			const store = createTopicStore({ id: 't1', title: 'T' } as never);
			await store.regenerateDebate();

			const sessionUpdate = vi
				.mocked(updateDoc)
				.mock.calls.find((c) => (c[0] as { path: string }).path === 'topics/t1/sessions/0');
			expect(sessionUpdate?.[1]).toEqual(
				expect.objectContaining({ turns: [], postDebateComments: [] })
			);
			expect(sessionUpdate?.[1]).not.toHaveProperty('status');
			expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'startDebate', expect.any(Object));
			expect(mockStartFn).toHaveBeenCalledWith({ topicId: 't1' });
		});
	});

	describe('stopDebate (task 2.1)', () => {
		it('トピックの phaseStatus を stopped にする（session には書かない）', async () => {
			const store = createTopicStore({ id: 't1', title: 'T' } as never);
			await store.stopDebate();

			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({ phaseStatus: 'stopped' })
			);
		});
	});

	describe('生成失敗時の停止書き込み (task 2.1)', () => {
		it('generateStakeholders が失敗したらトピックを (1, stopped) にして再スローする', async () => {
			vi.mocked(httpsCallable).mockReturnValue(
				vi.fn().mockRejectedValue(new Error('生成失敗')) as never
			);
			const store = createTopicStore({ id: 't1', title: 'T' } as never);

			await expect(store.generateStakeholders()).rejects.toThrow('生成失敗');
			const calls = updateCallsFor('topics/t1');
			expect(calls.at(-1)?.[1]).toEqual(
				expect.objectContaining({ phase: 1, phaseStatus: 'stopped' })
			);
		});
	});

	describe('generateStakeholders の下流ペルソナ削除 (task 3.1)', () => {
		it('既存ペルソナドキュメントを batch.delete する', async () => {
			vi.mocked(httpsCallable).mockReturnValue(
				vi.fn().mockResolvedValue({ data: { stakeholders: [] } }) as never
			);
			const ref1 = { path: 'topics/t1/personas/p1' };
			const ref2 = { path: 'topics/t1/personas/p2' };
			vi.mocked(getDocs).mockResolvedValue({ docs: [{ ref: ref1 }, { ref: ref2 }] } as never);

			const store = createTopicStore({ id: 't1', title: 'T' } as never);
			await store.generateStakeholders();

			expect(mockBatch.delete).toHaveBeenCalledWith(ref1);
			expect(mockBatch.delete).toHaveBeenCalledWith(ref2);
		});
	});

	describe('clearDebateSession', () => {
		it('討論セッションを削除する', async () => {
			const store = createTopicStore({ id: 't1' } as never);
			await store.clearDebateSession();

			expect(deleteDoc).toHaveBeenCalledWith({ path: 'topics/t1/sessions/0' });
		});
	});

	it('reset系メソッドは撲滅されている（regenerateに統合済み）', () => {
		const store = createTopicStore({ id: 't1' } as never);
		expect('resetToPhase1' in store).toBe(false);
		expect('resetToPhase2' in store).toBe(false);
		expect('resetToPhase3' in store).toBe(false);
		expect('resetToPhase4' in store).toBe(false);
		expect('resetDebate' in store).toBe(false);
	});
});
