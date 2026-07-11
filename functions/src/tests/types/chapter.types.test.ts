import { describe, it, expect } from 'vitest';
import type {
	ChapterForFirestore,
	PendingTurn,
	PendingTurnStatus,
	EditedChapterForFirestore,
	EditingChapterStatus
} from '../../types/chapter.types.js';

describe('chapter.types 生成中ターン（pendingTurn / frontier 外の未確定ターン）', () => {
	it('PendingTurnStatus は generating / fact-checking', () => {
		const statuses: PendingTurnStatus[] = ['generating', 'fact-checking'];
		expect(statuses).toHaveLength(2);
	});

	it('PendingTurn は発番 id・話者・frontier 位置・生成段階を持つ', () => {
		const pending: PendingTurn = {
			id: 'p-turn-1',
			personaId: 'persona-1',
			expectedTurnIndex: 3,
			status: 'generating'
		};
		expect(pending.id).toBe('p-turn-1');
		expect(pending.personaId).toBe('persona-1');
		expect(pending.expectedTurnIndex).toBe(3);
		expect(pending.status).toBe('generating');
	});

	it('ChapterForFirestore は生成中のみ pendingTurn を持つ（任意フィールド）', () => {
		const running: ChapterForFirestore = {
			chapterIndex: 1,
			title: '核心',
			agenda: ['論点A'],
			turns: [],
			status: 'running',
			pendingTurn: {
				id: 'p-turn-1',
				personaId: 'persona-1',
				expectedTurnIndex: 0,
				status: 'fact-checking'
			}
		};
		expect(running.pendingTurn?.status).toBe('fact-checking');

		const idle: ChapterForFirestore = {
			chapterIndex: 1,
			title: '核心',
			agenda: ['論点A'],
			turns: [],
			status: 'running'
		};
		expect(idle.pendingTurn).toBeUndefined();
	});
});

describe('chapter.types 編集後章（editorial から集約）', () => {
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

	it('検証不合格の理由（failureReason）を保持できる', () => {
		const chapter: EditedChapterForFirestore = {
			chapterIndex: 1,
			title: '章',
			agenda: [],
			turns: [],
			status: 'failed',
			failureReason: '原本に存在しない sourceTurnId: ghost'
		};
		expect(chapter.failureReason).toContain('ghost');
	});
});
