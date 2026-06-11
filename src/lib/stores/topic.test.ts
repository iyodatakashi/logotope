import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
	onSnapshot: vi.fn(),
	doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
	updateDoc: vi.fn().mockResolvedValue(undefined),
	deleteDoc: vi.fn().mockResolvedValue(undefined),
	writeBatch: vi.fn(),
	Timestamp: { now: vi.fn(() => 'NOW') },
	getDocs: vi.fn(),
	collection: vi.fn(),
	deleteField: vi.fn(() => 'DELETE_FIELD'),
	getDoc: vi.fn()
}));

import { writeBatch, updateDoc, getDoc } from 'firebase/firestore';
import { createTopicStore } from './topic.svelte.js';

const makeBatch = () => ({
	delete: vi.fn(),
	update: vi.fn(),
	commit: vi.fn().mockResolvedValue(undefined)
});

describe('createTopicStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('resetToPhase3', () => {
		it('セッション削除とstatusのinterviewingへの巻き戻しを行う', async () => {
			const batch = makeBatch();
			vi.mocked(writeBatch).mockReturnValue(batch as never);
			vi.mocked(getDoc).mockResolvedValue({
				exists: () => false,
				data: () => undefined
			} as never);

			const store = createTopicStore('t1');
			await store.resetToPhase3();

			expect(batch.delete).toHaveBeenCalledWith({ path: 'topics/t1/sessions/0' });
			expect(batch.update).toHaveBeenCalledWith(
				{ path: 'topics/t1' },
				expect.objectContaining({ status: 'interviewing' })
			);
			expect(batch.commit).toHaveBeenCalledOnce();
		});

		it('実行中討論があればキャンセルしてからリセットする', async () => {
			const batch = makeBatch();
			vi.mocked(writeBatch).mockReturnValue(batch as never);
			vi.mocked(getDoc).mockResolvedValue({
				exists: () => true,
				data: () => ({ status: 'debating' })
			} as never);

			const store = createTopicStore('t1');
			await store.resetToPhase3();

			expect(updateDoc).toHaveBeenCalledWith(
				{ path: 'topics/t1/sessions/0' },
				{ status: 'cancelled' }
			);
			expect(batch.commit).toHaveBeenCalledOnce();
		});
	});

	it('重複していたresetDebateは公開されていない（resetToPhase3に統合済み）', () => {
		const store = createTopicStore('t1');
		expect('resetDebate' in store).toBe(false);
	});
});
