import { describe, it, expect, vi } from 'vitest';

let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
		snapshotCb = cb;
		return () => {};
	}),
	doc: vi.fn()
}));

import { createEditorialStore } from '$lib/stores/editorial.svelte';

// 単一ドキュメント editorial/0 のスナップショットを模す（exists()/data() を持つ）。
const emit = (store: ReturnType<typeof createEditorialStore>, data: unknown | null) => {
	store.start();
	snapshotCb?.({
		exists: () => data !== null,
		data: () => data
	});
};

describe('createEditorialStore（進捗ステータス公開・backfill）', () => {
	it('ドキュメント自体が無い場合、導入・締めは生成待ち（pending）・所感は空にする（Req 7.2）', () => {
		const store = createEditorialStore('t1');
		emit(store, null);
		expect(store.intro).toEqual({ status: 'pending', draft: null, final: null });
		expect(store.outro).toEqual({ status: 'pending', draft: null, final: null });
		expect(store.impressions).toEqual([]);
		expect(store.isLoaded).toBe(true);
	});

	it('status 欠落の既存データは完了（finished）として正規化する（内容は保持・Req 7.1）', () => {
		const store = createEditorialStore('t1');
		emit(store, {
			intro: { draft: '導入原本', final: '導入編集後' }, // status 無し
			outro: { draft: '締め原本', final: null }, // status 無し・編集失敗相当
			impressions: {
				p1: { sortOrder: 0, draft: '所感原本', final: '所感編集後' } // status 無し
			}
		});
		expect(store.intro).toEqual({ status: 'finished', draft: '導入原本', final: '導入編集後' });
		expect(store.outro).toEqual({ status: 'finished', draft: '締め原本', final: null });
		expect(store.impressions[0]).toEqual({
			personaId: 'p1',
			sortOrder: 0,
			status: 'finished',
			draft: '所感原本',
			final: '所感編集後'
		});
	});

	it('status 付きデータはそのまま公開する（生成待ち・生成中も保持）', () => {
		const store = createEditorialStore('t1');
		emit(store, {
			intro: { status: 'generating', draft: null, final: null },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {
				p1: { sortOrder: 0, status: 'editing', draft: '原本', final: null }
			}
		});
		expect(store.intro.status).toBe('generating');
		expect(store.outro.status).toBe('pending');
		expect(store.impressions[0].status).toBe('editing');
	});

	it('所感を personaId materialize し sortOrder 順に並べる', () => {
		const store = createEditorialStore('t1');
		emit(store, {
			intro: { status: 'finished', draft: null, final: null },
			outro: { status: 'finished', draft: null, final: null },
			impressions: {
				p2: { sortOrder: 1, status: 'finished', draft: 'b', final: 'b' },
				p1: { sortOrder: 0, status: 'finished', draft: 'a', final: 'a' }
			}
		});
		expect(store.impressions.map((i) => i.personaId)).toEqual(['p1', 'p2']);
	});
});
