import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { ChapterDoc, ChapterAnalysisDoc, Issue, IssueGroup } from '$lib/models/chapter/chapter.types';
import type { TurnDoc } from '$lib/models/turn/turn.types';

describe('chapter.types - チャプタードキュメント型定義', () => {
	it('ChapterDoc は章メタ・ターン配列・進行ステータスを持つ', () => {
		const chapter: ChapterDoc = {
			chapterIndex: 0,
			title: '導入',
			focusQuestion: 'この問題の核心は何か？',
			discussionPoints: ['論点A', '論点B'],
			turns: [],
			status: 'pending',
		};
		expect(chapter.chapterIndex).toBe(0);
		expect(chapter.status).toBe('pending');
	});

	it('ChapterDoc は turns と discussionPointStatuses を保持する', () => {
		const turn: TurnDoc = {
			id: 't1',
			speakerType: 'persona',
			content: 'テスト発言',
			createdAt: Timestamp.fromDate(new Date()),
		};
		const chapter: ChapterDoc = {
			chapterIndex: 1,
			title: '核心',
			focusQuestion: '最も意見が分かれる点は？',
			discussionPoints: ['論点A'],
			turns: [turn],
			discussionPointStatuses: [{ point: '論点A', status: 'introduced' }],
			status: 'running',
		};
		expect(chapter.turns).toHaveLength(1);
		expect(chapter.discussionPointStatuses).toHaveLength(1);
	});

	it('Issue は text・source と段階的に付与されるスコア・選別フラグを持つ', () => {
		const issue: Issue = {
			text: '一般的切り口',
			source: 'general',
			score: 8,
			reason: '中心的な論点',
			selected: true,
		};
		expect(issue.source).toBe('general');
		expect(issue.selected).toBe(true);
	});

	it('Issue は text と source のみでも成立する（スコア付与前）', () => {
		const issue: Issue = { text: 'ペルソナ別切り口', source: 'persona' };
		expect(issue.score).toBeUndefined();
	});

	it('IssueGroup は issues 配列へのインデックス参照のみを持つ', () => {
		const group: IssueGroup = { issueIndexes: [0, 2] };
		expect(group.issueIndexes).toEqual([0, 2]);
	});

	it('ChapterAnalysisDoc は issues 配列と任意の issueGroups を持つ', () => {
		const analysis: ChapterAnalysisDoc = {
			issues: [
				{ text: '一般的切り口', source: 'general' },
				{ text: 'ペルソナ別切り口', source: 'persona' },
			],
			issueGroups: [{ issueIndexes: [0, 1] }],
		};
		expect(analysis.issues).toHaveLength(2);
		expect(analysis.issueGroups?.[0].issueIndexes).toEqual([0, 1]);
	});
});
