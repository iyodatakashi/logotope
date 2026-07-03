import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { EditedTurnDraft } from '../../../agents/editor-agent.js';
import type { DebateTurn } from '../../../types/turn.types.js';
import type { Persona } from '../../../types/persona.types.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' }
}));

vi.mock('ai', () => ({ generateObject: vi.fn() }));
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: vi.fn(() => 'mock-model') }));

import { generateObject } from 'ai';
import {
	validateEditedChapter,
	computeProtectedTurnIds,
	runChapterEditStep,
	runCommentsEditStep
} from '../../../pipeline/editing/editing-step.js';

const mockGenerateObject = vi.mocked(generateObject);

const makeTurn = (id: string, overrides: Partial<DebateTurn> = {}): DebateTurn => ({
	id,
	speakerType: 'persona',
	personaId: 'p1',
	content: `発言${id}`,
	createdAt: 'TS' as unknown as DebateTurn['createdAt'],
	...overrides
});

const makeDraft = (
	sourceTurnIds: string[],
	overrides: Partial<EditedTurnDraft> = {}
): EditedTurnDraft => ({
	sourceTurnIds,
	speakerType: 'persona',
	personaId: 'p1',
	content: '編集後',
	...overrides
});

beforeEach(() => {
	holder.mock = createFirestoreMock();
	mockGenerateObject.mockReset();
});

describe('validateEditedChapter', () => {
	const raw = [makeTurn('t1'), makeTurn('t2'), makeTurn('t3')];

	it('由来ID妥当・話者整合・時系列昇順・保護対象残存なら合格', () => {
		const drafts = [makeDraft(['t1', 't2']), makeDraft(['t3'])];
		const result = validateEditedChapter(drafts, raw, new Set(['t1']));
		expect(result.ok).toBe(true);
	});

	it('原本に存在しない sourceTurnId は不合格', () => {
		const result = validateEditedChapter([makeDraft(['tX'])], raw, new Set());
		expect(result.ok).toBe(false);
	});

	it('保護対象が除外されていれば不合格', () => {
		const result = validateEditedChapter([makeDraft(['t2', 't3'])], raw, new Set(['t1']));
		expect(result.ok).toBe(false);
	});

	it('連結ターンの話者が食い違えば不合格（衝突した話者を理由に含める）', () => {
		const mixed = [makeTurn('t1'), makeTurn('t2', { personaId: 'p2' })];
		const result = validateEditedChapter([makeDraft(['t1', 't2'])], mixed, new Set());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain('ペルソナ(p2)');
			expect(result.error.message).toContain('ペルソナ(p1)');
		}
	});

	it('ファシリテーターとペルソナの連結は話者衝突として不合格', () => {
		const mixed = [makeTurn('t1'), makeTurn('t2', { speakerType: 'facilitator', personaId: null })];
		const result = validateEditedChapter([makeDraft(['t1', 't2'])], mixed, new Set());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain('ファシリテーター');
		}
	});

	it('由来IDの重複使用は不合格', () => {
		const result = validateEditedChapter(
			[makeDraft(['t1']), makeDraft(['t1', 't2'])],
			raw,
			new Set()
		);
		expect(result.ok).toBe(false);
	});

	it('時系列順序が逆転していれば不合格', () => {
		const result = validateEditedChapter([makeDraft(['t3']), makeDraft(['t1'])], raw, new Set());
		expect(result.ok).toBe(false);
	});
});

describe('computeProtectedTurnIds', () => {
	it('speechMode=fact・factCheck指摘・信念変化トリガーを保護対象にする', () => {
		const turns = [
			makeTurn('t1', { speechMode: 'fact' }),
			makeTurn('t2', {
				factCheck: { status: 'checked', revised: false, findings: [{ id: 'f1' } as never] }
			}),
			makeTurn('t3'),
			makeTurn('t4')
		];
		const personas = [
			{ id: 'p1', beliefs: [{ triggeredByTurnId: 't3' }, { triggeredByTurnId: 'other-chapter' }] }
		] as unknown as Persona[];

		const result = computeProtectedTurnIds(turns, personas);
		expect(result).toEqual(new Set(['t1', 't2', 't3']));
	});
});

describe('runChapterEditStep', () => {
	beforeEach(() => {
		holder.mock!.store.set('topics/t1/personas/p1', {
			topicId: 't1',
			name: 'p1',
			approved: true,
			sortOrder: 0,
			stakeholderRole: '一般'
		});
		holder.mock!.store.set('topics/t1/chapters/c1', {
			chapterIndex: 0,
			title: '第1章',
			discussionPoints: ['論点'],
			turns: [
				{ id: 't1', speakerType: 'persona', personaId: 'p1', content: '発言1', createdAt: 'TS' },
				{ id: 't2', speakerType: 'persona', personaId: 'p1', content: '発言2', createdAt: 'TS' }
			]
		});
	});

	it('構造検証に合格すれば completed で編集後章を保存する', async () => {
		mockGenerateObject.mockResolvedValueOnce({
			object: {
				turns: [
					{ sourceTurnIds: ['t1', 't2'], speakerType: 'persona', personaId: 'p1', content: '連結' }
				]
			}
		} as never);

		const status = await runChapterEditStep('t1', 0, 'r1');

		expect(status).toBe('completed');
		const doc = holder.mock!.store.get('topics/t1/editedChapters/c1');
		expect(doc).toMatchObject({ chapterIndex: 0, status: 'completed' });
		expect((doc!.turns as unknown[]).length).toBe(1);
		expect((doc!.turns as Array<{ id: string }>)[0].id).toBeTruthy();
	});

	it('構造検証に不合格なら failed・turns:[] で記録する（章別フォールバック）', async () => {
		// t2 が原本に無い ID を指す → 検証不合格
		mockGenerateObject.mockResolvedValueOnce({
			object: {
				turns: [
					{ sourceTurnIds: ['t1', 'ghost'], speakerType: 'persona', personaId: 'p1', content: 'x' }
				]
			}
		} as never);

		const status = await runChapterEditStep('t1', 0, 'r1');

		expect(status).toBe('failed');
		const doc = holder.mock!.store.get('topics/t1/editedChapters/c1');
		expect(doc).toMatchObject({ status: 'failed' });
		expect(doc!.turns).toEqual([]);
		// 診断のため構造検証の不合格理由を成果物に残す（原本に無い sourceTurnId を指摘）
		expect(typeof doc!.failureReason).toBe('string');
		expect(doc!.failureReason as string).toContain('ghost');
	});

	it('LLM 失敗は例外を投げてタスクのリトライに委ねる', async () => {
		mockGenerateObject.mockRejectedValueOnce(new Error('api down'));
		await expect(runChapterEditStep('t1', 0, 'r1')).rejects.toThrow();
	});

	it('原本ターンが空の章はスキップし、LLM を呼ばず成果物も書かない', async () => {
		// 原本が存在しない（turns が空）章に差し替える
		holder.mock!.store.set('topics/t1/chapters/c1', {
			chapterIndex: 0,
			title: '第1章',
			discussionPoints: [],
			turns: []
		});

		const status = await runChapterEditStep('t1', 0, 'r1');

		expect(status).toBe('skipped');
		expect(mockGenerateObject).not.toHaveBeenCalled();
		// 成果物ドキュメントは書かれない（FE は missing として原本にフォールバックする）
		expect(holder.mock!.store.has('topics/t1/editedChapters/c1')).toBe(false);
	});

	it('原本章そのものが存在しないインデックスはスキップする', async () => {
		const status = await runChapterEditStep('t1', 99, 'r1');
		expect(status).toBe('skipped');
		expect(mockGenerateObject).not.toHaveBeenCalled();
	});
});

describe('runCommentsEditStep', () => {
	beforeEach(() => {
		holder.mock!.store.set('topics/t1', { phase: 'editing', phaseStatus: 'running', runId: 'r1' });
		holder.mock!.store.set('topics/t1/personas/p1', {
			topicId: 't1',
			name: 'p1',
			approved: true,
			sortOrder: 0,
			stakeholderRole: '一般'
		});
		holder.mock!.store.set('topics/t1/editedChapters/c1', {
			chapterIndex: 0,
			title: '第1章',
			discussionPoints: [],
			turns: [],
			status: 'completed'
		});
	});

	it('コメントをリライトして保存し、全章 completed なら generated に確定する', async () => {
		holder.mock!.store.set('topics/t1/postDebateComments/0', {
			comments: [{ id: 'rc1', personaId: 'p1', content: '冗長な感想', sortOrder: 0 }]
		});
		mockGenerateObject.mockResolvedValueOnce({
			object: { comments: [{ sourceCommentId: 'rc1', content: '読みやすい感想' }] }
		} as never);

		const result = await runCommentsEditStep('t1', 'r1');

		expect(result).toBe('generated');
		const doc = holder.mock!.store.get('topics/t1/editedPostDebateComments/0');
		expect(
			(doc!.comments as Array<{ sourceCommentId: string; sortOrder: number }>)[0]
		).toMatchObject({
			sourceCommentId: 'rc1',
			sortOrder: 0
		});
	});

	it('コメントが無ければ空成果物を書いて確定する（LLM 呼び出しなし）', async () => {
		const result = await runCommentsEditStep('t1', 'r1');

		expect(mockGenerateObject).not.toHaveBeenCalled();
		expect(holder.mock!.store.get('topics/t1/editedPostDebateComments/0')).toEqual({
			comments: []
		});
		expect(result).toBe('generated');
	});
});
