import { describe, it, expect, vi } from 'vitest';
import type { EditedIntroClosingForFirestore } from '$lib/models/editedIntroClosing/editedIntroClosing.types';

let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
		snapshotCb = cb;
		return () => {};
	}),
	doc: vi.fn()
}));

import { createEditedIntroClosingStore } from '$lib/stores/editedIntroClosing.svelte';

const populate = (
	store: ReturnType<typeof createEditedIntroClosingStore>,
	data: EditedIntroClosingForFirestore | null
) => {
	store.start();
	snapshotCb?.({ exists: () => data !== null, data: () => data });
};

describe('createEditedIntroClosingStore', () => {
	it('intro/closing がスナップショットから反映される', () => {
		const store = createEditedIntroClosingStore('topic1');
		expect(store.intro).toBeNull();
		expect(store.closing).toBeNull();

		populate(store, { intro: 'イントロ本文', closing: 'クロージング本文' });
		expect(store.intro).toBe('イントロ本文');
		expect(store.closing).toBe('クロージング本文');
	});

	it('ドキュメント未生成（exists=false）なら intro/closing とも null', () => {
		const store = createEditedIntroClosingStore('topic1');
		populate(store, null);
		expect(store.intro).toBeNull();
		expect(store.closing).toBeNull();
	});

	it('片方のみ生成（他方 null）を保持する', () => {
		const store = createEditedIntroClosingStore('topic1');
		populate(store, { intro: 'イントロのみ', closing: null });
		expect(store.intro).toBe('イントロのみ');
		expect(store.closing).toBeNull();
	});

	it('isLoaded が start 後のスナップショット受信で true になる', () => {
		const store = createEditedIntroClosingStore('topic1');
		expect(store.isLoaded).toBe(false);
		populate(store, null);
		expect(store.isLoaded).toBe(true);
	});
});
