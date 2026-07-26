import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { EditedChapterForFirestore } from '../../../types/chapter.types.js';

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
	writeEditedChapter,
	readEditedChapters,
	clearEditedArtifact
} from '../../../pipeline/editing/edited-repository.js';

const chapterPath = (chapterId: string) => `topics/t1/editedChapters/${chapterId}`;
const EDITORIAL_PATH = 'topics/t1/editorial/outputs';

const makeChapter = (
	chapterId: string,
	chapterIndex: number,
	status: EditedChapterForFirestore['status'] = 'completed'
): EditedChapterForFirestore => ({
	chapterIndex,
	title: `章${chapterIndex}`,
	agenda: ['論点'],
	turns:
		status === 'failed'
			? []
			: [
					{
						id: `et-${chapterId}`,
						sourceTurnIds: [`raw-${chapterId}`],
						speakerType: 'persona',
						personaId: 'p1',
						content: '編集後の散文'
					}
				],
	status
});

beforeEach(() => {
	holder.mock = createFirestoreMock();
});

describe('writeEditedChapter', () => {
	it('編集後章を editedChapters/{chapterId} に書き込む', async () => {
		await writeEditedChapter('t1', 'c1', makeChapter('c1', 0));
		const doc = holder.mock!.store.get(chapterPath('c1'));
		expect(doc).toMatchObject({ chapterIndex: 0, status: 'completed' });
		expect((doc!.turns as unknown[]).length).toBe(1);
	});

	it('失敗章を status:failed・turns:[] で記録できる', async () => {
		await writeEditedChapter('t1', 'c2', makeChapter('c2', 1, 'failed'));
		const doc = holder.mock!.store.get(chapterPath('c2'));
		expect(doc!.status).toBe('failed');
		expect(doc!.turns).toEqual([]);
	});

	it('同一 chapterId への再書き込みは冪等上書きする', async () => {
		await writeEditedChapter('t1', 'c1', makeChapter('c1', 0, 'failed'));
		await writeEditedChapter('t1', 'c1', makeChapter('c1', 0, 'completed'));
		const doc = holder.mock!.store.get(chapterPath('c1'));
		expect(doc!.status).toBe('completed');
	});
});

describe('readEditedChapters', () => {
	it('編集後章を chapterIndex 昇順で返す', async () => {
		await writeEditedChapter('t1', 'c2', makeChapter('c2', 1));
		await writeEditedChapter('t1', 'c1', makeChapter('c1', 0));
		const chapters = await readEditedChapters('t1');
		expect(chapters.map((c) => c.chapterIndex)).toEqual([0, 1]);
	});

	it('編集後章が無ければ空配列を返す', async () => {
		expect(await readEditedChapters('t1')).toEqual([]);
	});
});

describe('clearEditedArtifact', () => {
	it('全 editedChapters を削除し 統合保存 editorial/outputs を初期化する', async () => {
		await writeEditedChapter('t1', 'c1', makeChapter('c1', 0));
		await writeEditedChapter('t1', 'c2', makeChapter('c2', 1));
		holder.mock!.store.set(EDITORIAL_PATH, {
			intro: { draft: '導入', final: '導入編集後' },
			outro: { draft: null, final: null },
			impressions: { p1: { sortOrder: 0, draft: '所感', final: null } }
		});

		await clearEditedArtifact('t1');

		expect(holder.mock!.store.has(chapterPath('c1'))).toBe(false);
		expect(holder.mock!.store.has(chapterPath('c2'))).toBe(false);
		expect(holder.mock!.store.get(EDITORIAL_PATH)).toEqual({
			intro: { status: 'pending', draft: null, final: null },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});
	});

	it('原本（chapters）は一切変更しない', async () => {
		holder.mock!.store.set('topics/t1/chapters/c1', { chapterIndex: 0, turns: ['raw'] });
		await writeEditedChapter('t1', 'c1', makeChapter('c1', 0));

		await clearEditedArtifact('t1');

		expect(holder.mock!.store.get('topics/t1/chapters/c1')).toEqual({
			chapterIndex: 0,
			turns: ['raw']
		});
	});

	it('討論ダイジェストのキャッシュ（editorial/digest）も削除して無効化する（R5.3）', async () => {
		holder.mock!.store.set('topics/t1/editorial/digest', {
			topicTitle: 'テーマ',
			chapters: [],
			personas: []
		});

		await clearEditedArtifact('t1');

		expect(holder.mock!.store.has('topics/t1/editorial/digest')).toBe(false);
	});
});
