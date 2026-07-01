import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type {
	EditedChapterForFirestore,
	EditedPostDebateCommentsForFirestore
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
	writeEditedChapter,
	writeEditedComments,
	readEditedChapters,
	clearEditedArtifact
} from '../../../pipeline/editing/edited-repository.js';

const chapterPath = (chapterId: string) => `topics/t1/editedChapters/${chapterId}`;
const COMMENTS_PATH = 'topics/t1/editedPostDebateComments/0';

const makeChapter = (
	chapterId: string,
	chapterIndex: number,
	status: EditedChapterForFirestore['status'] = 'completed'
): EditedChapterForFirestore => ({
	chapterIndex,
	title: `章${chapterIndex}`,
	discussionPoints: ['論点'],
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

const makeComments = (): EditedPostDebateCommentsForFirestore => ({
	comments: [
		{ id: 'ec1', sourceCommentId: 'rc1', personaId: 'p1', content: 'コメント', sortOrder: 0 }
	]
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

describe('writeEditedComments', () => {
	it('編集後コメントを editedPostDebateComments/0 に書き込む', async () => {
		await writeEditedComments('t1', makeComments());
		const doc = holder.mock!.store.get(COMMENTS_PATH);
		expect((doc!.comments as unknown[]).length).toBe(1);
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
	it('全 editedChapters を削除し editedPostDebateComments を空にする', async () => {
		await writeEditedChapter('t1', 'c1', makeChapter('c1', 0));
		await writeEditedChapter('t1', 'c2', makeChapter('c2', 1));
		await writeEditedComments('t1', makeComments());

		await clearEditedArtifact('t1');

		expect(holder.mock!.store.has(chapterPath('c1'))).toBe(false);
		expect(holder.mock!.store.has(chapterPath('c2'))).toBe(false);
		expect(holder.mock!.store.get(COMMENTS_PATH)).toEqual({ comments: [] });
	});

	it('原本（chapters・postDebateComments）は一切変更しない', async () => {
		holder.mock!.store.set('topics/t1/chapters/c1', { chapterIndex: 0, turns: ['raw'] });
		holder.mock!.store.set('topics/t1/postDebateComments/0', { comments: ['raw'] });
		await writeEditedChapter('t1', 'c1', makeChapter('c1', 0));

		await clearEditedArtifact('t1');

		expect(holder.mock!.store.get('topics/t1/chapters/c1')).toEqual({
			chapterIndex: 0,
			turns: ['raw']
		});
		expect(holder.mock!.store.get('topics/t1/postDebateComments/0')).toEqual({
			comments: ['raw']
		});
	});
});
