import { describe, it, expect, vi } from 'vitest';
import type { FactBaseForFirestore } from '$lib/models/factBase/factBase.types';

let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
		snapshotCb = cb;
		return () => {};
	}),
	doc: vi.fn((_db: unknown, ...segs: string[]) => ({ path: segs.join('/') })),
	setDoc: vi.fn()
}));

import { createFactBaseStore } from '$lib/stores/factBase.svelte';
import { setDoc } from 'firebase/firestore';

const fire = (data: FactBaseForFirestore | null) => {
	snapshotCb?.({
		exists: () => data !== null,
		data: () => (data !== null ? data : undefined)
	});
};

const sampleFactBase = (): FactBaseForFirestore => ({
	facts: [{ statement: '事実', sources: [{ title: 'a', url: 'https://a' }] }],
	generatedAt: { __ts: 'now' } as never
});

describe('createFactBaseStore', () => {
	it('ドキュメントが存在しない場合 data は null', () => {
		const store = createFactBaseStore('topic1');
		store.start();
		fire(null);
		expect(store.data).toBeNull();
	});

	it('ドキュメントが存在する場合 data に事実基盤がセットされる', () => {
		const store = createFactBaseStore('topic1');
		store.start();
		const fb = sampleFactBase();
		fire(fb);
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
		expect(setDoc).toHaveBeenCalledWith({ path: 'topics/topic1/factBase/0' }, fb);
	});
});
