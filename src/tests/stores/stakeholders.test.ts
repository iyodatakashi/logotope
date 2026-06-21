import { describe, it, expect, vi } from 'vitest';
import type { StakeholderForFirestore } from '$lib/models/topic/topic.types';

let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
		snapshotCb = cb;
		return () => {};
	}),
	doc: vi.fn(),
}));

import { createStakeholdersStore } from '$lib/stores/stakeholders.svelte';

const fire = (stakeholders: StakeholderForFirestore[] | null) => {
	snapshotCb?.({
		exists: () => stakeholders !== null,
		data: () => (stakeholders !== null ? { stakeholders } : undefined)
	});
};

describe('createStakeholdersStore', () => {
	it('ドキュメントが存在しない場合 stakeholders は空配列', () => {
		const store = createStakeholdersStore('topic1');
		store.start();
		fire(null);
		expect(store.stakeholders).toEqual([]);
	});

	it('ドキュメントが存在する場合 stakeholders に値がセットされる', () => {
		const store = createStakeholdersStore('topic1');
		store.start();
		fire([{ role: '医師', reason: '専門家', mainInterests: [], minorityLevel: 'low' }]);
		expect(store.stakeholders).toEqual([
			{ role: '医師', reason: '専門家', mainInterests: [], minorityLevel: 'low' }
		]);
	});

	it('isLoaded がスナップショット受信前は false', () => {
		const store = createStakeholdersStore('topic1');
		expect(store.isLoaded).toBe(false);
	});

	it('isLoaded がスナップショット受信後は true', () => {
		const store = createStakeholdersStore('topic1');
		store.start();
		fire(null);
		expect(store.isLoaded).toBe(true);
	});
});
