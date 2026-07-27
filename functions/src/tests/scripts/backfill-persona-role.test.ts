import { describe, it, expect } from 'vitest';
import { planRoleBackfill } from '../../scripts/backfill-persona-role.js';

describe('planRoleBackfill — specificRole → role の冪等移行', () => {
	it('specificRole の値を role へ移す', () => {
		expect(
			planRoleBackfill([{ id: 'p1', specificRole: '救急医', stakeholderRole: '医療従事者' }])
		).toEqual([{ id: 'p1', role: '救急医' }]);
	});

	it('specificRole が欠落・空・空白のみなら stakeholderRole を一度だけ焼き込む', () => {
		expect(
			planRoleBackfill([
				{ id: 'p1', stakeholderRole: '市民' },
				{ id: 'p2', specificRole: '', stakeholderRole: '住民' },
				{ id: 'p3', specificRole: '   ', stakeholderRole: '労働者' }
			])
		).toEqual([
			{ id: 'p1', role: '市民' },
			{ id: 'p2', role: '住民' },
			{ id: 'p3', role: '労働者' }
		]);
	});

	it('既に非空の role を持つペルソナはスキップする（冪等・再実行しても二重変換しない）', () => {
		expect(
			planRoleBackfill([{ id: 'p1', role: '救急医', specificRole: '旧値', stakeholderRole: '医療' }])
		).toEqual([]);
	});

	it('role が空文字・空白のみなら未移行として穴埋めする', () => {
		expect(
			planRoleBackfill([{ id: 'p1', role: '  ', specificRole: '教員', stakeholderRole: '教育' }])
		).toEqual([{ id: 'p1', role: '教員' }]);
	});

	it('specificRole も stakeholderRole も無ければ書き込まない（空の role を作らない）', () => {
		expect(planRoleBackfill([{ id: 'p1' }])).toEqual([]);
	});
});
