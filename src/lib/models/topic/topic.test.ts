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
import { updateDoc, setDoc, deleteDoc, getDoc, getDocs } from 'firebase/firestore';
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

	describe('生成の2軸遷移（生成のみ。旧データ削除は reset が担う）', () => {
		it('generateStakeholders は (1, running)→生成成功で (1, generated)。削除はしない', async () => {
			vi.mocked(httpsCallable).mockReturnValue(
				vi.fn().mockResolvedValue({ data: { stakeholders: [{ role: 'A' }] } }) as never
			);
			const store = createTopicStore({ id: 't1', title: 'T' } as never);
			await store.generateStakeholders();

			const calls = updateCallsFor('topics/t1');
			expect(calls[0][1]).toEqual(expect.objectContaining({ phase: 1, phaseStatus: 'running' }));
			expect(calls.at(-1)?.[1]).toEqual(
				expect.objectContaining({ phase: 1, phaseStatus: 'generated' })
			);
			// 生成関数は削除を行わない
			expect(mockBatch.delete).not.toHaveBeenCalled();
			expect(deleteDoc).not.toHaveBeenCalled();
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

	describe('旧データのリセット（データ層ごと。名前＝役割範囲）', () => {
		it('resetStakeholders は stakeholders を空に戻す', async () => {
			const store = createTopicStore({ id: 't1' } as never);
			await store.resetStakeholders();
			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({
					stakeholders: { items: [], approved: false, createdAt: 'NOW' }
				})
			);
		});

		it('resetPersonas は既存ペルソナ文書を全削除する', async () => {
			const ref1 = { path: 'topics/t1/personas/p1' };
			const ref2 = { path: 'topics/t1/personas/p2' };
			vi.mocked(getDocs).mockResolvedValue({ docs: [{ ref: ref1 }, { ref: ref2 }] } as never);

			const store = createTopicStore({ id: 't1' } as never);
			await store.resetPersonas();

			expect(deleteDoc).toHaveBeenCalledWith(ref1);
			expect(deleteDoc).toHaveBeenCalledWith(ref2);
		});

		it('resetChapters は session の chapters を消す（merge・章立て層のみ）', async () => {
			const store = createTopicStore({ id: 't1' } as never);
			await store.resetChapters();
			expect(setDoc).toHaveBeenCalledWith(
				{ path: 'topics/t1/sessions/0' },
				expect.objectContaining({ chapters: 'DELETE_FIELD' }),
				{ merge: true }
			);
		});

		it('resetDebate は session の turns を消し、章立て・status は触らない', async () => {
			const store = createTopicStore({ id: 't1' } as never);
			await store.resetDebate();
			const call = vi
				.mocked(setDoc)
				.mock.calls.find((c) => (c[0] as { path: string }).path === 'topics/t1/sessions/0');
			expect(call?.[1]).toEqual(expect.objectContaining({ turns: [], postDebateComments: [] }));
			expect(call?.[1]).not.toHaveProperty('chapters');
			expect(call?.[1]).not.toHaveProperty('status');
		});
	});

	it('旧 reset 名・バンドル操作は撲滅され、データ層ごとの reset へ統一されている', () => {
		const store = createTopicStore({ id: 't1' } as never);
		// 旧: フェーズ番号ベース／reset と生成を兼ねたバンドル操作は無い
		expect('resetToPhase1' in store).toBe(false);
		expect('resetToPhase2' in store).toBe(false);
		expect('resetToPhase3' in store).toBe(false);
		expect('resetToPhase4' in store).toBe(false);
		expect('clearDebateSession' in store).toBe(false);
		expect('regenerateDebate' in store).toBe(false);
		// 新: データ層ごとの純粋な reset（名前＝役割範囲）
		expect('resetStakeholders' in store).toBe(true);
		expect('resetPersonas' in store).toBe(true);
		expect('resetChapters' in store).toBe(true);
		expect('resetDebate' in store).toBe(true);
	});
});
