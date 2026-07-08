import { describe, it, expect } from 'vitest';
import {
	isNonEmptyArray,
	type EditedTurnForFirestore,
	type EditedChapterForFirestore,
	type EditingChapterStatus,
	type EditedPostDebateCommentForFirestore,
	type EditedPostDebateCommentsForFirestore
} from '../../types/editorial.types.js';

describe('editorial.types isNonEmptyArray（由来ターンID群の不変条件）', () => {
	it('要素が1件以上あれば true（型を NonEmptyArray に絞る）', () => {
		const single = ['t1'];
		const many = ['t1', 't2'];
		expect(isNonEmptyArray(single)).toBe(true);
		expect(isNonEmptyArray(many)).toBe(true);
	});

	it('空配列は false', () => {
		expect(isNonEmptyArray([])).toBe(false);
	});
});

describe('editorial.types 編集後ターン', () => {
	it('由来ターンIDが1件の編集後ターンを表現できる', () => {
		const turn: EditedTurnForFirestore = {
			id: 'e1',
			sourceTurnIds: ['t1'],
			speakerType: 'persona',
			personaId: 'p1',
			content: '編集後の散文',
			speechMode: 'opinion'
		};
		expect(turn.sourceTurnIds).toHaveLength(1);
		expect(isNonEmptyArray(turn.sourceTurnIds)).toBe(true);
	});

	it('連結時は複数の由来ターンIDを持てる', () => {
		const turn: EditedTurnForFirestore = {
			id: 'e2',
			sourceTurnIds: ['t1', 't2'],
			speakerType: 'facilitator',
			personaId: null,
			content: '連結された散文'
		};
		expect(turn.sourceTurnIds).toHaveLength(2);
	});
});

describe('editorial.types 編集後章', () => {
	it('編集状態（pending/completed/failed）を持つ編集後章を表現できる', () => {
		const statuses: EditingChapterStatus[] = ['pending', 'completed', 'failed'];
		for (const status of statuses) {
			const chapter: EditedChapterForFirestore = {
				chapterIndex: 0,
				title: '章タイトル',
				agenda: ['論点A'],
				turns: [],
				status
			};
			expect(chapter.status).toBe(status);
		}
	});
});

describe('editorial.types 編集後コメント', () => {
	it('由来コメントを保持した編集後コメント列を表現できる', () => {
		const comment: EditedPostDebateCommentForFirestore = {
			id: 'ec1',
			sourceCommentId: 'c1',
			personaId: 'p1',
			content: '編集後コメント',
			sortOrder: 0
		};
		const comments: EditedPostDebateCommentsForFirestore = { comments: [comment] };
		expect(comments.comments[0].sourceCommentId).toBe('c1');
	});
});
