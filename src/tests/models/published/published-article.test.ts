import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/firebase-public.js', () => ({ publicDb: {} }));

vi.mock('firebase/firestore', () => ({
	doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
	collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
	query: vi.fn((ref: unknown) => ref),
	orderBy: vi.fn((field: string) => ({ field })),
	getDoc: vi.fn(),
	getDocs: vi.fn()
}));

import { getDoc, getDocs } from 'firebase/firestore';
import { fetchPublishedArticle } from '$lib/models/published/published-article';

type Data = Record<string, unknown>;
type CollDoc = { id: string; data: Data };

const makeTimestamp = (date: Date) => ({ toDate: () => date });

const docSnap = (data: Data | null | undefined) => ({
	exists: () => data != null,
	data: () => data
});
const querySnap = (docs: CollDoc[]) => ({
	docs: docs.map((entry) => ({ id: entry.id, data: () => entry.data }))
});

// path ベースで getDoc/getDocs のモックを構成する。
const setup = (fixture: {
	topic?: Data | null;
	editorial?: Data | null;
	editedChapters?: CollDoc[];
	chapters?: CollDoc[];
	personas?: CollDoc[];
}) => {
	vi.mocked(getDoc).mockImplementation((ref: unknown) => {
		const path = (ref as { path: string }).path;
		const data = path.endsWith('/editorial/0') ? fixture.editorial : fixture.topic;
		return Promise.resolve(docSnap(data) as unknown as Awaited<ReturnType<typeof getDoc>>);
	});
	vi.mocked(getDocs).mockImplementation((ref: unknown) => {
		const path = (ref as { path: string }).path;
		const docs = path.endsWith('editedChapters')
			? fixture.editedChapters
			: path.endsWith('chapters')
				? fixture.chapters
				: fixture.personas;
		return Promise.resolve(querySnap(docs ?? []) as unknown as Awaited<ReturnType<typeof getDocs>>);
	});
};

const publishedTopic = { title: 'T', published: true, publishedAt: makeTimestamp(new Date(2026, 0, 1)) };

describe('fetchPublishedArticle — 公開判定と写像', () => {
	beforeEach(() => vi.clearAllMocks());

	it('published が true でない場合は null を返す', async () => {
		setup({ topic: { title: 'T', published: false, publishedAt: makeTimestamp(new Date()) } });
		expect(await fetchPublishedArticle('t1')).toBeNull();
	});

	it('publishedAt 欠落の場合は null を返す', async () => {
		setup({ topic: { title: 'T', published: true } });
		expect(await fetchPublishedArticle('t1')).toBeNull();
	});

	it('topic が存在しない場合は null を返す', async () => {
		setup({ topic: null });
		expect(await fetchPublishedArticle('t1')).toBeNull();
	});

	it('permission-denied は null を返す', async () => {
		vi.mocked(getDoc).mockRejectedValue({ code: 'permission-denied' });
		expect(await fetchPublishedArticle('t1')).toBeNull();
	});

	it('permission-denied 以外の取得失敗は例外を送出する', async () => {
		vi.mocked(getDoc).mockRejectedValue({ code: 'unavailable' });
		await expect(fetchPublishedArticle('t1')).rejects.toMatchObject({ code: 'unavailable' });
	});
});

describe('fetchPublishedArticle — 射影と join', () => {
	beforeEach(() => vi.clearAllMocks());

	const fullFixture = {
		topic: { title: '公開タイトル', published: true, publishedAt: makeTimestamp(new Date(2026, 3, 15)) },
		editorial: {
			intro: { final: 'INTRO-final', draft: 'INTRO-draft' },
			outro: { final: null, draft: 'OUTRO-draft' },
			impressions: {
				p2: { sortOrder: 1, final: 'imp2-final', draft: null },
				p1: { sortOrder: 0, final: null, draft: 'imp1-draft' },
				p3: { sortOrder: 2, final: null, draft: null }
			}
		},
		personas: [
			{
				id: 'p1',
				data: {
					name: 'Alice',
					specificRole: 'RoleA',
					stakeholderRole: 'SA',
					awarenesses: [{ content: 'aw-t1', triggeredByTurnId: 't1' }]
				}
			},
			{
				id: 'p2',
				data: {
					name: 'Bob',
					stakeholderRole: 'SB',
					awarenesses: [{ content: 'aw-t2', triggeredByTurnId: 't2' }]
				}
			}
		],
		chapters: [
			{
				id: 'c0',
				data: {
					chapterIndex: 0,
					title: 'orig-title-0',
					turns: [
						{ id: 't1', speakerType: 'persona', personaId: 'p1', content: 'orig-t1' },
						{ id: 't2', speakerType: 'facilitator', content: 'facil-t2' }
					]
				}
			},
			{
				id: 'c1',
				data: {
					chapterIndex: 1,
					title: 'orig-title-1',
					turns: [
						{ id: 't3', speakerType: 'persona', personaId: 'p2', content: 'orig-t3' },
						{ id: 't4', speakerType: 'facilitator', content: 'orig-t4' }
					]
				}
			}
		],
		editedChapters: [
			{
				id: 'e0',
				data: {
					chapterIndex: 0,
					title: 'edited-title-0',
					status: 'completed',
					turns: [
						{ id: 'e1', sourceTurnIds: ['t1', 't2'], speakerType: 'persona', personaId: 'p1', content: 'edited-e1' }
					]
				}
			},
			{
				id: 'e1',
				data: {
					chapterIndex: 1,
					title: 'edited-title-1',
					status: 'failed',
					turns: [
						{ id: 'ex', sourceTurnIds: ['t3'], speakerType: 'persona', personaId: 'p2', content: 'edited-ex' }
					]
				}
			}
		]
	};

	it('見出し・publishedAt を射影する（Timestamp→Date）', async () => {
		setup(fullFixture);
		const article = await fetchPublishedArticle('t1');
		expect(article?.id).toBe('t1');
		expect(article?.title).toBe('公開タイトル');
		expect(article?.publishedAt).toEqual(new Date(2026, 3, 15));
	});

	it('導入・締めは final ?? draft を採用する', async () => {
		setup(fullFixture);
		const article = await fetchPublishedArticle('t1');
		expect(article?.intro).toBe('INTRO-final');
		expect(article?.outro).toBe('OUTRO-draft');
	});

	it('導入・締めが両方 null の要素は null（省略）にする', async () => {
		setup({
			topic: publishedTopic,
			editorial: { intro: { final: null, draft: null }, outro: { final: null, draft: null }, impressions: {} }
		});
		const article = await fetchPublishedArticle('t1');
		expect(article?.intro).toBeNull();
		expect(article?.outro).toBeNull();
	});

	it('editorial ドキュメントが無い場合も intro/outro は null', async () => {
		setup({ topic: publishedTopic, editorial: null });
		const article = await fetchPublishedArticle('t1');
		expect(article?.intro).toBeNull();
		expect(article?.outro).toBeNull();
		expect(article?.impressions).toEqual([]);
	});

	it('完了章は編集後、それ以外は原本を採用する', async () => {
		setup(fullFixture);
		const article = await fetchPublishedArticle('t1');
		expect(article?.chapters[0].title).toBe('edited-title-0');
		expect(article?.chapters[0].speeches.map((s) => s.id)).toEqual(['e1']);
		// chapterIndex 1 は failed のため原本にフォールバック
		expect(article?.chapters[1].title).toBe('orig-title-1');
		expect(article?.chapters[1].speeches.map((s) => s.id)).toEqual(['t3', 't4']);
	});

	it('章は chapterIndex 順で index を持つ', async () => {
		setup(fullFixture);
		const article = await fetchPublishedArticle('t1');
		expect(article?.chapters.map((c) => c.index)).toEqual([0, 1]);
	});

	it('話者を解決する（persona は name/role、facilitator はラベル）', async () => {
		setup(fullFixture);
		const article = await fetchPublishedArticle('t1');
		const persona = article?.chapters[0].speeches[0];
		expect(persona).toMatchObject({ speakerType: 'persona', speakerName: 'Alice', speakerRole: 'RoleA' });
		const facilitator = article?.chapters[1].speeches[1];
		expect(facilitator).toMatchObject({
			speakerType: 'facilitator',
			speakerName: 'ファシリテーター',
			speakerRole: ''
		});
	});

	it('specificRole が無い persona は stakeholderRole を役割にする', async () => {
		setup(fullFixture);
		const article = await fetchPublishedArticle('t1');
		expect(article?.chapters[1].speeches[0]).toMatchObject({ speakerName: 'Bob', speakerRole: 'SB' });
	});

	it('編集後発話は複数 sourceTurnIds の気づきを集約する', async () => {
		setup(fullFixture);
		const article = await fetchPublishedArticle('t1');
		expect(article?.chapters[0].speeches[0].awarenesses).toEqual([
			{ personaName: 'Alice', content: 'aw-t1' },
			{ personaName: 'Bob', content: 'aw-t2' }
		]);
	});

	it('原本発話は自ターン id で気づきを逆引きし、無ければ空配列', async () => {
		setup(fullFixture);
		const article = await fetchPublishedArticle('t1');
		// t3・t4 に紐づく気づきは無い
		expect(article?.chapters[1].speeches[0].awarenesses).toEqual([]);
		expect(article?.chapters[1].speeches[1].awarenesses).toEqual([]);
	});

	it('所感は sortOrder 昇順で final ?? draft を採用し、両 null は省く', async () => {
		setup(fullFixture);
		const article = await fetchPublishedArticle('t1');
		expect(article?.impressions).toEqual([
			{ personaId: 'p1', speakerName: 'Alice', speakerRole: 'RoleA', content: 'imp1-draft' },
			{ personaId: 'p2', speakerName: 'Bob', speakerRole: 'SB', content: 'imp2-final' }
		]);
	});

	it('診断注釈（speechMode 等）は射影に含めない', async () => {
		setup(fullFixture);
		const article = await fetchPublishedArticle('t1');
		expect(article?.chapters[0].speeches[0]).not.toHaveProperty('speechMode');
		expect(article?.chapters[0].speeches[0]).not.toHaveProperty('factCheck');
	});
});
