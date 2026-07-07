import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { ImpressionPartForFirestore } from '../../../types/editorial.types.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore
}));

import {
	readEditorial,
	setIntro,
	setOutro,
	setImpression,
	clearEditorial
} from '../../../pipeline/editing/editorial-repository.js';

const EDITORIAL_PATH = 'topics/t1/editorial/0';

const impression = (
	sortOrder: number,
	draft: string | null,
	final: string | null
): ImpressionPartForFirestore => ({ sortOrder, draft, final });

beforeEach(() => {
	holder.mock = createFirestoreMock();
});

describe('readEditorial', () => {
	it('未生成なら空（intro/outro=null・impressions={}）で返す', async () => {
		expect(await readEditorial('t1')).toEqual({
			intro: { draft: null, final: null },
			outro: { draft: null, final: null },
			impressions: {}
		});
	});

	it('欠落項目を空として補完して返す', async () => {
		holder.mock!.store.set(EDITORIAL_PATH, { intro: { draft: '導入原本', final: '導入編集後' } });
		expect(await readEditorial('t1')).toEqual({
			intro: { draft: '導入原本', final: '導入編集後' },
			outro: { draft: null, final: null },
			impressions: {}
		});
	});

	it('書いた内容を読み戻せる', async () => {
		await clearEditorial('t1');
		await setIntro('t1', { draft: 'd', final: 'f' });
		await setImpression('t1', 'p1', impression(0, 'pd', 'pf'));
		const editorial = await readEditorial('t1');
		expect(editorial.intro).toEqual({ draft: 'd', final: 'f' });
		expect(editorial.impressions.p1).toEqual({ sortOrder: 0, draft: 'pd', final: 'pf' });
	});
});

describe('clearEditorial', () => {
	it('基底ドキュメント（intro/outro=null・impressions={}）を作る', async () => {
		await clearEditorial('t1');
		expect(holder.mock!.store.get(EDITORIAL_PATH)).toEqual({
			intro: { draft: null, final: null },
			outro: { draft: null, final: null },
			impressions: {}
		});
	});

	it('既存の記事要素を破棄する', async () => {
		await clearEditorial('t1');
		await setIntro('t1', { draft: 'd', final: 'f' });
		await setImpression('t1', 'p1', impression(0, 'pd', 'pf'));

		await clearEditorial('t1');

		expect(await readEditorial('t1')).toEqual({
			intro: { draft: null, final: null },
			outro: { draft: null, final: null },
			impressions: {}
		});
	});
});

describe('setIntro / setOutro（部分上書き・他要素不変）', () => {
	beforeEach(async () => {
		await clearEditorial('t1');
		await setOutro('t1', { draft: '締め原本', final: '締め編集後' });
		await setImpression('t1', 'p1', impression(0, '所感原本', '所感編集後'));
	});

	it('setIntro は intro のみ更新し outro・impressions を変えない', async () => {
		await setIntro('t1', { draft: '導入原本', final: '導入編集後' });
		const editorial = await readEditorial('t1');
		expect(editorial.intro).toEqual({ draft: '導入原本', final: '導入編集後' });
		expect(editorial.outro).toEqual({ draft: '締め原本', final: '締め編集後' });
		expect(editorial.impressions.p1).toEqual({ sortOrder: 0, draft: '所感原本', final: '所感編集後' });
	});

	it('setOutro は outro のみ更新し intro・impressions を変えない', async () => {
		await setIntro('t1', { draft: '導入原本', final: '導入編集後' });
		await setOutro('t1', { draft: '締め改', final: null });
		const editorial = await readEditorial('t1');
		expect(editorial.outro).toEqual({ draft: '締め改', final: null });
		expect(editorial.intro).toEqual({ draft: '導入原本', final: '導入編集後' });
		expect(editorial.impressions.p1).toEqual({ sortOrder: 0, draft: '所感原本', final: '所感編集後' });
	});
});

describe('setImpression（参加者単位の部分上書き・他要素不変）', () => {
	beforeEach(async () => {
		await clearEditorial('t1');
		await setIntro('t1', { draft: '導入原本', final: '導入編集後' });
		await setImpression('t1', 'p1', impression(0, 'p1原本', 'p1編集後'));
		await setImpression('t1', 'p2', impression(1, 'p2原本', 'p2編集後'));
	});

	it('1人分の更新は当該ペルソナのみ変え、他ペルソナ・intro を変えない', async () => {
		await setImpression('t1', 'p1', impression(0, 'p1原本改', 'p1編集後改'));
		const editorial = await readEditorial('t1');
		expect(editorial.impressions.p1).toEqual({ sortOrder: 0, draft: 'p1原本改', final: 'p1編集後改' });
		expect(editorial.impressions.p2).toEqual({ sortOrder: 1, draft: 'p2原本', final: 'p2編集後' });
		expect(editorial.intro).toEqual({ draft: '導入原本', final: '導入編集後' });
	});

	it('新規ペルソナの追加は既存ペルソナを変えない', async () => {
		await setImpression('t1', 'p3', impression(2, 'p3原本', null));
		const editorial = await readEditorial('t1');
		expect(Object.keys(editorial.impressions).sort()).toEqual(['p1', 'p2', 'p3']);
		expect(editorial.impressions.p1).toEqual({ sortOrder: 0, draft: 'p1原本', final: 'p1編集後' });
		expect(editorial.impressions.p3).toEqual({ sortOrder: 2, draft: 'p3原本', final: null });
	});
});
