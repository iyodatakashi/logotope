import { describe, it, expect, vi } from 'vitest';
import type { FactBase, FactBaseForFirestore } from '#lib/models/factBase/factBase.types.ts';

let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('#lib/stores/firebase.ts', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
		snapshotCb = cb;
		return () => {};
	}),
	doc: vi.fn((_db: unknown, ...segs: string[]) => ({ path: segs.join('/') })),
	setDoc: vi.fn(),
	Timestamp: { fromDate: vi.fn((date: Date) => ({ toDate: () => date })) }
}));

import { createFactBaseStore } from '#lib/stores/factBase.svelte.ts';
import { setDoc } from 'firebase/firestore';

const fire = (data: FactBaseForFirestore | null) => {
	snapshotCb?.({
		exists: () => data !== null,
		data: () => (data !== null ? data : undefined)
	});
};

const generatedAt = new Date(2026, 0, 1);

const sampleFactBase = (): FactBase => ({
	facts: [{ statement: '事実', sources: [{ title: 'a', url: 'https://a' }] }],
	generatedAt
});

const persistedOf = (factBase: FactBase): FactBaseForFirestore => ({
	facts: factBase.facts,
	generatedAt: { toDate: () => factBase.generatedAt } as never
});

describe('createFactBaseStore', () => {
	it('ドキュメントが存在しない場合 data は null', () => {
		const store = createFactBaseStore('topic1');
		store.start();
		fire(null);
		expect(store.data).toBeNull();
	});

	it('ドキュメントが存在する場合 data に事実基盤がセットされる（生成基準日は Date）', () => {
		const store = createFactBaseStore('topic1');
		store.start();
		const fb = sampleFactBase();
		fire(persistedOf(fb));
		expect(store.data).toEqual(fb);
	});

	it('isLoaded がスナップショット受信前は false', () => {
		const store = createFactBaseStore('topic1');
		expect(store.isLoaded).toBe(false);
	});

	it('isLoaded がスナップショット受信後は true', () => {
		const store = createFactBaseStore('topic1');
		store.start();
		fire(null);
		expect(store.isLoaded).toBe(true);
	});

	it('save は編集内容を factBase/0 に書き込む', async () => {
		const store = createFactBaseStore('topic1');
		const fb = sampleFactBase();
		await store.save(fb);
		expect(setDoc).toHaveBeenCalledWith(
			{ path: 'topics/topic1/factBase/0' },
			{ facts: fb.facts, generatedAt: expect.objectContaining({ toDate: expect.any(Function) }) }
		);
		const [, persisted] = vi.mocked(setDoc).mock.calls[0] as unknown as [
			unknown,
			FactBaseForFirestore
		];
		expect(persisted.generatedAt.toDate()).toBe(generatedAt);
	});
});
