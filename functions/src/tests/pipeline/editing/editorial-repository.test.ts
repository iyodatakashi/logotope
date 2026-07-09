import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type {
	EditorialElementStatus,
	ImpressionForFirestore
} from '../../../types/editorial.types.js';

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
	clearEditorial,
	narrationWriter,
	impressionWriter
} from '../../../pipeline/editing/editorial-repository.js';

const EDITORIAL_PATH = 'topics/t1/editorial/0';

const impression = (
	sortOrder: number,
	status: EditorialElementStatus,
	draft: string | null,
	final: string | null
): ImpressionForFirestore => ({ sortOrder, status, draft, final });

const pending = { status: 'pending', draft: null, final: null } as const;

beforeEach(() => {
	holder.mock = createFirestoreMock();
});

describe('readEditorial', () => {
	it('未生成なら生成待ち（intro/outro=pending・impressions={}）で返す', async () => {
		expect(await readEditorial('t1')).toEqual({
			intro: pending,
			outro: pending,
			impressions: {}
		});
	});

	it('欠落項目を生成待ちとして補完して返す', async () => {
		holder.mock!.store.set(EDITORIAL_PATH, {
			intro: { status: 'finished', draft: '導入原本', final: '導入編集後' }
		});
		expect(await readEditorial('t1')).toEqual({
			intro: { status: 'finished', draft: '導入原本', final: '導入編集後' },
			outro: pending,
			impressions: {}
		});
	});

	it('書いた内容を読み戻せる', async () => {
		await clearEditorial('t1');
		await setIntro('t1', { status: 'finished', draft: 'd', final: 'f' });
		await setImpression('t1', 'p1', impression(0, 'finished', 'pd', 'pf'));
		const editorial = await readEditorial('t1');
		expect(editorial.intro).toEqual({ status: 'finished', draft: 'd', final: 'f' });
		expect(editorial.impressions.p1).toEqual({ sortOrder: 0, status: 'finished', draft: 'pd', final: 'pf' });
	});
});

describe('clearEditorial', () => {
	it('基底ドキュメント（intro/outro=生成待ち・impressions={}）を作る', async () => {
		await clearEditorial('t1');
		expect(holder.mock!.store.get(EDITORIAL_PATH)).toEqual({
			intro: pending,
			outro: pending,
			impressions: {}
		});
	});

	it('既存の記事要素を破棄する', async () => {
		await clearEditorial('t1');
		await setIntro('t1', { status: 'finished', draft: 'd', final: 'f' });
		await setImpression('t1', 'p1', impression(0, 'finished', 'pd', 'pf'));

		await clearEditorial('t1');

		expect(await readEditorial('t1')).toEqual({
			intro: pending,
			outro: pending,
			impressions: {}
		});
	});
});

describe('setIntro / setOutro（部分上書き・他要素不変）', () => {
	beforeEach(async () => {
		await clearEditorial('t1');
		await setOutro('t1', { status: 'finished', draft: '締め原本', final: '締め編集後' });
		await setImpression('t1', 'p1', impression(0, 'finished', '所感原本', '所感編集後'));
	});

	it('setIntro は intro のみ更新し outro・impressions を変えない', async () => {
		await setIntro('t1', { status: 'finished', draft: '導入原本', final: '導入編集後' });
		const editorial = await readEditorial('t1');
		expect(editorial.intro).toEqual({ status: 'finished', draft: '導入原本', final: '導入編集後' });
		expect(editorial.outro).toEqual({ status: 'finished', draft: '締め原本', final: '締め編集後' });
		expect(editorial.impressions.p1).toEqual({ sortOrder: 0, status: 'finished', draft: '所感原本', final: '所感編集後' });
	});
});

describe('setImpression（参加者単位の部分上書き・他要素不変）', () => {
	beforeEach(async () => {
		await clearEditorial('t1');
		await setIntro('t1', { status: 'finished', draft: '導入原本', final: '導入編集後' });
		await setImpression('t1', 'p1', impression(0, 'finished', 'p1原本', 'p1編集後'));
		await setImpression('t1', 'p2', impression(1, 'finished', 'p2原本', 'p2編集後'));
	});

	it('1人分の更新は当該ペルソナのみ変え、他ペルソナ・intro を変えない', async () => {
		await setImpression('t1', 'p1', impression(0, 'finished', 'p1原本改', 'p1編集後改'));
		const editorial = await readEditorial('t1');
		expect(editorial.impressions.p1).toEqual({ sortOrder: 0, status: 'finished', draft: 'p1原本改', final: 'p1編集後改' });
		expect(editorial.impressions.p2).toEqual({ sortOrder: 1, status: 'finished', draft: 'p2原本', final: 'p2編集後' });
		expect(editorial.intro).toEqual({ status: 'finished', draft: '導入原本', final: '導入編集後' });
	});
});

describe('narrationWriter（段階書き込み: 生成中→整え中→完了）', () => {
	beforeEach(async () => {
		await clearEditorial('t1');
	});

	it('begin は生成中にし内容を破棄する（再生成での旧内容破棄）', async () => {
		await setIntro('t1', { status: 'finished', draft: '旧原本', final: '旧編集後' });
		await narrationWriter('t1', 'intro').begin();
		expect((await readEditorial('t1')).intro).toEqual({ status: 'generating', draft: null, final: null });
	});

	it('toEditing は整え中にし原本のみ保存する（final は据え置き）', async () => {
		const writer = narrationWriter('t1', 'intro');
		await writer.begin();
		await writer.toEditing('原本');
		expect((await readEditorial('t1')).intro).toEqual({ status: 'editing', draft: '原本', final: null });
	});

	it('finish は完了で内容を確定する（編集済み/編集失敗/生成失敗）', async () => {
		await narrationWriter('t1', 'intro').finish({ draft: '原本', final: '編集後' });
		await narrationWriter('t1', 'outro').finish({ draft: null, final: null });
		const editorial = await readEditorial('t1');
		expect(editorial.intro).toEqual({ status: 'finished', draft: '原本', final: '編集後' });
		expect(editorial.outro).toEqual({ status: 'finished', draft: null, final: null });
	});
});

describe('impressionWriter（sortOrder を保った段階書き込み）', () => {
	beforeEach(async () => {
		await clearEditorial('t1');
	});

	it('begin→toEditing→finish で sortOrder を保ったまま段階を書く', async () => {
		const writer = impressionWriter('t1', 'p1', 3);
		await writer.begin();
		expect((await readEditorial('t1')).impressions.p1).toEqual({ sortOrder: 3, status: 'generating', draft: null, final: null });

		await writer.toEditing('原本');
		expect((await readEditorial('t1')).impressions.p1).toEqual({ sortOrder: 3, status: 'editing', draft: '原本', final: null });

		await writer.finish({ draft: '原本', final: '編集後' });
		expect((await readEditorial('t1')).impressions.p1).toEqual({ sortOrder: 3, status: 'finished', draft: '原本', final: '編集後' });
	});
});
