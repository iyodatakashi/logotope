import { describe, it, expect, vi } from 'vitest';
import type { StakeholderForFirestore } from '$lib/models/stakeholder/stakeholder.types';

let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
		snapshotCb = cb;
		return () => {};
	}),
	doc: vi.fn()
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

	it('永続された安定 id をそのまま採用する', () => {
		const store = createStakeholdersStore('topic1');
		store.start();
		fire([
			{ id: 'sid-a', role: '医師', reason: '専門家', mainInterests: [], minorityLevel: 'low' },
			{ id: 'sid-b', role: '患者', reason: '当事者', mainInterests: [], minorityLevel: 'high' }
		]);
		expect(store.stakeholders).toEqual([
			{ id: 'sid-a', role: '医師', reason: '専門家', mainInterests: [], minorityLevel: 'low' },
			{ id: 'sid-b', role: '患者', reason: '当事者', mainInterests: [], minorityLevel: 'high' }
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
