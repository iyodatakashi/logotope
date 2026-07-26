import { describe, it, expect } from 'vitest';
import type {
	EditorialStatus,
	Narration,
	ImpressionForFirestore
} from '../../types/editorial.types.js';

describe('editorial.types 記事要素の進捗ステータス', () => {
	it('進捗ステータスは生成待ち／生成中／整え中／完了の4値を取る', () => {
		const statuses: EditorialStatus[] = ['pending', 'generating', 'editing', 'finished'];
		expect(statuses).toHaveLength(4);
	});

	it('導入・締めの永続形は進捗ステータスを持ち、生成待ちと失敗を区別できる（ともに内容は空）', () => {
		const pending: Narration = { status: 'pending', draft: null, final: null };
		const failed: Narration = { status: 'finished', draft: null, final: null };
		expect(pending.status).toBe('pending');
		expect(failed.status).toBe('finished');
		// 内容だけでは区別できないが、ステータスで区別できる
		expect(pending.draft).toBe(failed.draft);
		expect(pending.final).toBe(failed.final);
		expect(pending.status).not.toBe(failed.status);
	});

	it('所感の永続形は進捗ステータスを持つ（sortOrder は不変）', () => {
		const impression: ImpressionForFirestore = {
			sortOrder: 2,
			status: 'editing',
			draft: '原本',
			final: null
		};
		expect(impression.status).toBe('editing');
		expect(impression.sortOrder).toBe(2);
	});
});
