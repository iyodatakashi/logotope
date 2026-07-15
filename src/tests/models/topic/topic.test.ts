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
import { updateDoc, deleteDoc, setDoc, getDoc, getDocs } from 'firebase/firestore';
import { createTopicStates } from '$lib/models/topic/createTopic.svelte';

const TOPIC_PATH = { path: 'topics/t1' };
const mockTimestamp = { toDate: () => new Date() };
const makeTopic = (extra: Record<string, unknown> = {}) =>
	createTopicStates({
		id: 't1',
		createdAt: mockTimestamp,
		updatedAt: mockTimestamp,
		...extra
	} as never);
const updateCallsFor = (path: string) =>
	vi.mocked(updateDoc).mock.calls.filter((c) => (c[0] as { path: string }).path === path);

describe('createTopicStates', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDoc).mockResolvedValue({ exists: () => false, data: () => undefined } as never);
		vi.mocked(getDocs).mockResolvedValue({ docs: [] } as never);
	});

	describe('テーマ設定フェーズ', () => {
		it('save は編集中の題名・説明・参考URLを保存する', async () => {
			const store = makeTopic();
			store.title = '新しい題名';
			store.description = '背景';
			store.sourceUrls = ['https://example.com'];
			await store.save();
			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({
					title: '新しい題名',
					description: '背景',
					sourceUrls: ['https://example.com']
				})
			);
		});

		it('save は空の説明・参考URLをフィールドごと削除する', async () => {
			const store = makeTopic({ title: '題名', description: '', sourceUrls: [] });
			await store.save();
			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({
					description: 'DELETE_FIELD',
					sourceUrls: 'DELETE_FIELD'
				})
			);
		});

		it('save は空題名を保存せず、永続済みの題名へ戻す', async () => {
			const store = makeTopic({ title: '元の題名' });
			store.title = '   ';
			await store.save();
			expect(store.title).toBe('元の題名');
			expect(updateCallsFor('topics/t1')).toHaveLength(0);
		});

		it('fetchSourceContents は fetchSourceContents onCall を topicId 付きで呼ぶ', async () => {
			const callable = vi.fn().mockResolvedValue({ data: {} });
			vi.mocked(httpsCallable).mockReturnValue(callable as never);

			const store = makeTopic();
			await store.fetchSourceContents();

			expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'fetchSourceContents');
			expect(callable).toHaveBeenCalledWith({ topicId: 't1' });
		});

		it('approveTheme は (fact-research, not_started) へ前進する', async () => {
			const store = makeTopic();
			await store.approveTheme();
			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({ phase: 'fact-research', phaseStatus: 'not_started' })
			);
		});
	});

	describe('承認操作の2軸遷移 (task 3.1)', () => {
		it('approveFactResearch は (personas, not_started) へ前進し事実リサーチを承認する', async () => {
			const store = makeTopic();
			await store.approveFactResearch();
			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({
					phase: 'personas',
					phaseStatus: 'not_started'
				})
			);
		});

		it('advancePastPersonas は (chapters, not_started) へ前進する（採用ゲートは画面が担保）', async () => {
			const store = makeTopic();
			await store.advancePastPersonas();
			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({ phase: 'chapters', phaseStatus: 'not_started' })
			);
		});

		it('approveChapters は (5, not_started) へ前進する', async () => {
			const store = makeTopic();
			await store.approveChapters();
			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({ phase: 'debate', phaseStatus: 'not_started' })
			);
		});

		it('approveDebate は (6, not_started) へ前進する（討論確定→編集）', async () => {
			const store = makeTopic();
			await store.approveDebate();
			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({ phase: 'editing', phaseStatus: 'not_started' })
			);
		});

		it('承認操作は旧 status を書き込まない', async () => {
			const store = makeTopic();
			await store.approveChapters();
			const call = vi.mocked(updateDoc).mock.calls.at(-1)?.[1] as unknown as Record<
				string,
				unknown
			>;
			expect(call).not.toHaveProperty('status');
		});
	});

	describe('編集フェーズの起動・再実行 (task 6.2)', () => {
		it('startEditing は startEditing onCall を topicId 付きで呼ぶ', async () => {
			const callable = vi.fn().mockResolvedValue({ data: { topicId: 't1' } });
			vi.mocked(httpsCallable).mockReturnValue(callable as never);

			const store = makeTopic();
			await store.startEditing();

			expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'startEditing', {
				timeout: 60000
			});
			expect(callable).toHaveBeenCalledWith({ topicId: 't1' });
		});

		it('resetEditing は resetEditing onCall を topicId 付きで呼ぶ', async () => {
			const callable = vi.fn().mockResolvedValue({ data: { topicId: 't1' } });
			vi.mocked(httpsCallable).mockReturnValue(callable as never);

			const store = makeTopic();
			await store.resetEditing();

			expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'resetEditing');
			expect(callable).toHaveBeenCalledWith({ topicId: 't1' });
		});
	});

	describe('生成の2軸遷移（生成のみ。旧データ削除は reset が担う）', () => {
		it('generateFactResearch は (fact-research, running) のみ書き、generated はサーバ権威', async () => {
			vi.mocked(httpsCallable).mockReturnValue(vi.fn().mockResolvedValue({ data: {} }) as never);
			const store = makeTopic({ title: 'T', id: 't1' });
			await store.generateFactResearch();

			expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'generateFactResearch', {
				timeout: 310000
			});
			const calls = updateCallsFor('topics/t1');
			expect(calls[0][1]).toEqual(
				expect.objectContaining({ phase: 'fact-research', phaseStatus: 'running' })
			);
			// 完了状態(generated)はサーバが書くため、クライアントは書かない
			expect(
				calls.some((call) => (call[1] as { phaseStatus?: string }).phaseStatus === 'generated')
			).toBe(false);
		});

		it('startPersonaGeneration は一気通貫の起動 onCall を topicId 付きで呼ぶ（フェーズ書込はサーバ権威）', async () => {
			const callable = vi.fn().mockResolvedValue({ data: { topicId: 't1' } });
			vi.mocked(httpsCallable).mockReturnValue(callable as never);
			const store = makeTopic({ title: 'T', id: 't1' });
			await store.startPersonaGeneration();

			expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'startPersonaGeneration', {
				timeout: 60000
			});
			expect(callable).toHaveBeenCalledWith({ topicId: 't1' });
			// running 化・runId 発行・段の投入はサーバ責務。クライアントはフェーズを書かない。
			expect(updateCallsFor('topics/t1')).toHaveLength(0);
			expect(setDoc).not.toHaveBeenCalled();
		});

		it('generateChapters は (4, running) のみ書き、generated はサーバ権威', async () => {
			vi.mocked(httpsCallable).mockReturnValue(vi.fn().mockResolvedValue({ data: {} }) as never);
			const store = makeTopic({ title: 'T' });
			await store.generateChapters();
			const calls = updateCallsFor('topics/t1');
			expect(calls[0][1]).toEqual(
				expect.objectContaining({ phase: 'chapters', phaseStatus: 'running' })
			);
			// 完了状態(generated)はサーバ(generateChapters 関数)が書くため、クライアントは書かない
			expect(
				calls.some((call) => (call[1] as { phaseStatus?: string }).phaseStatus === 'generated')
			).toBe(false);
		});
	});

	describe('stopDebate (task 2.1)', () => {
		it('トピックの phaseStatus を stopped にする（session には書かない）', async () => {
			const store = makeTopic({ title: 'T' });
			await store.stopDebate();

			expect(updateDoc).toHaveBeenCalledWith(
				TOPIC_PATH,
				expect.objectContaining({ phaseStatus: 'stopped' })
			);
		});
	});

	describe('生成失敗時の停止書き込み (task 2.1)', () => {
		it('generateChapters が失敗したらトピックを (4, stopped) にして再スローする', async () => {
			vi.mocked(httpsCallable).mockReturnValue(
				vi.fn().mockRejectedValue(new Error('生成失敗')) as never
			);
			const store = makeTopic({ title: 'T', id: 't1' });

			await expect(store.generateChapters()).rejects.toThrow('生成失敗');
			const calls = updateCallsFor('topics/t1');
			expect(calls.at(-1)?.[1]).toEqual(
				expect.objectContaining({ phase: 'chapters', phaseStatus: 'stopped' })
			);
		});

		it('generateChapters の callable が reject してもサーバが generated 済みなら stopped に上書きしない', async () => {
			vi.mocked(httpsCallable).mockReturnValue(
				vi.fn().mockRejectedValue(new Error('timeout')) as never
			);
			vi.mocked(getDoc).mockResolvedValue({
				exists: () => true,
				data: () => ({ phaseStatus: 'generated' })
			} as never);
			const store = makeTopic({ title: 'T', id: 't1' });

			await expect(store.generateChapters()).rejects.toThrow('timeout');
			const calls = updateCallsFor('topics/t1');
			expect(
				calls.some((call) => (call[1] as { phaseStatus?: string }).phaseStatus === 'stopped')
			).toBe(false);
		});
	});

	describe('旧データのリセット（データ層ごと。名前＝役割範囲）', () => {
		it('resetStakeholders は stakeholders/0 ドキュメントを削除する', async () => {
			const store = makeTopic();
			await store.resetStakeholders();
			expect(deleteDoc).toHaveBeenCalledWith({ path: 'topics/t1/stakeholders/0' });
		});

		it('resetPersonas は既存ペルソナ文書を全削除する', async () => {
			const ref1 = { path: 'topics/t1/personas/p1' };
			const ref2 = { path: 'topics/t1/personas/p2' };
			vi.mocked(getDocs).mockResolvedValue({ docs: [{ ref: ref1 }, { ref: ref2 }] } as never);

			const store = makeTopic();
			await store.resetPersonas();

			expect(deleteDoc).toHaveBeenCalledWith(ref1);
			expect(deleteDoc).toHaveBeenCalledWith(ref2);
		});

		it('resetChapters は chapters コレクションを全削除し chapterAnalysis/0 も削除する', async () => {
			const ref1 = { path: 'topics/t1/chapters/c1' };
			const ref2 = { path: 'topics/t1/chapters/c2' };
			vi.mocked(getDocs).mockResolvedValue({ docs: [{ ref: ref1 }, { ref: ref2 }] } as never);

			const store = makeTopic();
			await store.resetChapters();

			expect(deleteDoc).toHaveBeenCalledWith(ref1);
			expect(deleteDoc).toHaveBeenCalledWith(ref2);
			expect(deleteDoc).toHaveBeenCalledWith({ path: 'topics/t1/chapterAnalysis/0' });
		});

		it('resetDebate は resetDebate onCall を呼ぶだけ（クライアント側で個別削除しない）', async () => {
			const callable = vi.fn().mockResolvedValue({ data: { topicId: 't1' } });
			vi.mocked(httpsCallable).mockReturnValue(callable as never);

			const store = makeTopic();
			await store.resetDebate();

			expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'resetDebate');
			expect(callable).toHaveBeenCalledWith({ topicId: 't1' });
			// 章付随データの削除はサーバ責務。FE からは直接削除しない
			expect(deleteDoc).not.toHaveBeenCalled();
		});
	});

	it('旧 reset 名・バンドル操作は撲滅され、データ層ごとの reset へ統一されている', () => {
		const store = makeTopic();
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
