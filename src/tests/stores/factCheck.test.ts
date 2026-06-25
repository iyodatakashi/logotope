import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FactCheckResultForFirestore } from '$lib/models/factCheck/factCheck.types';

let snapshotCbs: Array<(snap: unknown) => void> = [];

const mockCallable = vi.fn().mockResolvedValue({ data: { topicId: 't1', chapterId: 'ch1' } });

vi.mock('$lib/firebase.js', () => ({ db: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
		snapshotCbs.push(cb);
		return vi.fn();
	}),
	getDocs: vi.fn(),
	collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
	doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }))
}));
vi.mock('firebase/functions', () => ({
	httpsCallable: vi.fn(() => mockCallable)
}));

import { toFactCheckResult, createFactCheckStore } from '$lib/stores/factCheck.svelte';
import { onSnapshot, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

const makeTimestamp = (ms: number) => ({ toDate: () => new Date(ms) });

const makeRaw = (
	overrides: Partial<FactCheckResultForFirestore> = {}
): FactCheckResultForFirestore =>
	({
		chapterId: 'ch1',
		status: 'completed',
		findings: [],
		sources: [],
		startedAt: makeTimestamp(0) as never,
		completedAt: makeTimestamp(1000) as never,
		...overrides
	}) as FactCheckResultForFirestore;

const docSnap = (data: unknown | null) => ({
	exists: () => data !== null,
	data: () => data
});

describe('toFactCheckResult', () => {
	it('Timestamp を Date に変換する', () => {
		const result = toFactCheckResult(makeRaw());
		expect(result.startedAt).toBeInstanceOf(Date);
		expect(result.completedAt).toBeInstanceOf(Date);
	});

	it('completedAt がなければ undefined のまま', () => {
		const result = toFactCheckResult(makeRaw({ completedAt: undefined }));
		expect(result.completedAt).toBeUndefined();
	});
});

describe('createFactCheckStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		snapshotCbs = [];
	});

	it('start() が chapters を getDocs で読み、各章の result doc を onSnapshot 購読する', async () => {
		vi.mocked(getDocs).mockResolvedValueOnce({ docs: [{ id: 'ch1' }, { id: 'ch2' }] } as never);
		const store = createFactCheckStore('topic1');
		store.start();
		await Promise.resolve();
		expect(vi.mocked(getDocs)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(onSnapshot)).toHaveBeenCalledTimes(2);
	});

	it('結果ドキュメント受信で resultsMap が chapterId キーで更新される', async () => {
		vi.mocked(getDocs).mockResolvedValueOnce({ docs: [{ id: 'ch1' }] } as never);
		const store = createFactCheckStore('topic1');
		store.start();
		await Promise.resolve();
		snapshotCbs[0]?.(docSnap(makeRaw({ status: 'running' })));
		expect(store.resultsMap.get('ch1')?.status).toBe('running');
	});

	it('結果ドキュメントが存在しなければ resultsMap から除外する', async () => {
		vi.mocked(getDocs).mockResolvedValueOnce({ docs: [{ id: 'ch1' }] } as never);
		const store = createFactCheckStore('topic1');
		store.start();
		await Promise.resolve();
		snapshotCbs[0]?.(docSnap(makeRaw()));
		expect(store.resultsMap.has('ch1')).toBe(true);
		snapshotCbs[0]?.(docSnap(null));
		expect(store.resultsMap.has('ch1')).toBe(false);
	});

	it('stop() で全購読が解除される', async () => {
		const unsub = vi.fn();
		vi.mocked(onSnapshot).mockReturnValue(unsub);
		vi.mocked(getDocs).mockResolvedValueOnce({ docs: [{ id: 'ch1' }, { id: 'ch2' }] } as never);
		const store = createFactCheckStore('topic1');
		store.start();
		await Promise.resolve();
		store.stop();
		expect(unsub).toHaveBeenCalledTimes(2);
	});

	it('runFactCheck が runFactCheck callable を topicId/chapterId 付きで呼ぶ', async () => {
		const store = createFactCheckStore('topic1');
		await store.runFactCheck('ch1');
		expect(vi.mocked(httpsCallable)).toHaveBeenCalledWith(
			expect.anything(),
			'runFactCheck',
			expect.objectContaining({ timeout: expect.any(Number) })
		);
		expect(mockCallable).toHaveBeenCalledWith({ topicId: 'topic1', chapterId: 'ch1' });
	});

	it('getRunState の初期値は pending=false / error=null', () => {
		const store = createFactCheckStore('topic1');
		expect(store.getRunState('ch1')).toEqual({ pending: false, error: null });
	});

	it('呼び出し中は pending=true、解決後に pending=false になる', async () => {
		let resolveCall: (v: unknown) => void = () => {};
		mockCallable.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveCall = resolve;
				})
		);
		const store = createFactCheckStore('topic1');
		const pending = store.runFactCheck('ch1');
		expect(store.getRunState('ch1').pending).toBe(true);
		resolveCall({ data: { topicId: 'topic1', chapterId: 'ch1' } });
		await pending;
		expect(store.getRunState('ch1').pending).toBe(false);
	});

	it('callable が失敗したら error を保持し pending=false にする（例外は投げない）', async () => {
		mockCallable.mockRejectedValueOnce(new Error('internal error'));
		const store = createFactCheckStore('topic1');
		await store.runFactCheck('ch1');
		expect(store.getRunState('ch1').error).toBe('internal error');
		expect(store.getRunState('ch1').pending).toBe(false);
	});
});
