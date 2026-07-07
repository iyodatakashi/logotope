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
vi.mock('../../../pipeline/editing/element-builders.js', () => ({ buildImpressionPart: vi.fn() }));

import { generateObject } from 'ai';
import { buildImpressionPart } from '../../../pipeline/editing/element-builders.js';
import {
	validateEditedChapter,
	computeProtectedTurnIds,
	runChapterEditStep,
	runImpressionsStep
} from '../../../pipeline/editing/editing-step.js';

const mockGenerateObject = vi.mocked(generateObject);
const mockBuildImpressionPart = vi.mocked(buildImpressionPart);

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
	mockBuildImpressionPart.mockReset();
});

describe('validateEditedChapter', () => {
	const raw = [makeTurn('t1'), makeTurn('t2'), makeTurn('t3')];

	it('由来ID妥当・話者整合・時系列昇順・保護対象残存なら合格', () => {
		const drafts = [makeDraft(['t1', 't2']), makeDraft(['t3'])];
		const result = validateEditedChapter(drafts, raw, new Set(['t1']));
		expect(result.ok).toBe(true);
	});

	it('ドラフトの personaId/speakerType が由来と食い違っても、由来が単一話者なら合格（ラベルは保存時に導出）', () => {
		// LLM が話者ラベルだけ間違えたケース（sourceTurnIds は正しい）。検証では弾かない。
		const drafts = [
			makeDraft(['t1'], { personaId: 'wrong', speakerType: 'facilitator' }),
			makeDraft(['t2', 't3'])
		];
		const result = validateEditedChapter(drafts, raw, new Set());
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
	it('speechMode=fact・factCheck指摘・気づきトリガーを保護対象にする', () => {
		const turns = [
			makeTurn('t1', { speechMode: 'fact' }),
			makeTurn('t2', {
				factCheck: { status: 'checked', revised: false, findings: [{ id: 'f1' } as never] }
			}),
			makeTurn('t3'),
			makeTurn('t4')
		];
		const personas = [
			{
				id: 'p1',
				awarenesses: [{ triggeredByTurnId: 't3' }, { triggeredByTurnId: 'other-chapter' }]
			}
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

	it('LLM が話者ラベル(personaId/speakerType)を間違えても、由来から導出して completed で保存する', async () => {
		// sourceTurnIds は正しいが personaId/speakerType が誤り。従来は failed になっていたケース。
		mockGenerateObject.mockResolvedValueOnce({
			object: {
				turns: [
					{ sourceTurnIds: ['t1', 't2'], speakerType: 'facilitator', personaId: 'wrong', content: '連結' }
				]
			}
		} as never);

		const status = await runChapterEditStep('t1', 0, 'r1');

		expect(status).toBe('completed');
		const turn = (
			holder.mock!.store.get('topics/t1/editedChapters/c1')!.turns as Array<{
				speakerType: string;
				personaId: string | null;
			}>
		)[0];
		// 由来ターン（t1/t2 は persona p1）から導出される
		expect(turn.speakerType).toBe('persona');
		expect(turn.personaId).toBe('p1');
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

describe('runImpressionsStep', () => {
	const setPersona = (id: string, sortOrder: number, approved: boolean) =>
		holder.mock!.store.set(`topics/t1/personas/${id}`, {
			topicId: 't1',
			name: id,
			approved,
			sortOrder,
			stakeholderRole: '一般'
		});

	beforeEach(() => {
		setPersona('p1', 0, true);
		setPersona('p2', 1, true);
		setPersona('p3', 2, false); // 未承認
		holder.mock!.store.set('topics/t1/chapters/c1', {
			chapterIndex: 0,
			title: '第1章',
			discussionPoints: [],
			turns: [{ id: 't1', speakerType: 'persona', personaId: 'p1', content: '発言', createdAt: 'TS' }]
		});
	});

	const editorial = () =>
		holder.mock!.store.get('topics/t1/editorial/0') as {
			impressions?: Record<string, unknown>;
		} | undefined;

	it('承認済みペルソナごとに所感を統合保存へ部分上書きし、未承認は対象外にする', async () => {
		mockBuildImpressionPart.mockImplementation(async (persona, _turns, _personas, sortOrder) => ({
			sortOrder,
			draft: `${persona.id}原本`,
			final: `${persona.id}編集後`
		}));

		await runImpressionsStep('t1');

		expect(mockBuildImpressionPart).toHaveBeenCalledTimes(2); // p1, p2 のみ（p3 未承認）
		expect(editorial()!.impressions).toEqual({
			p1: { sortOrder: 0, draft: 'p1原本', final: 'p1編集後' },
			p2: { sortOrder: 1, draft: 'p2原本', final: 'p2編集後' }
		});
	});

	it('全滅（null）の参加者は書かず欠けとして残し、他参加者は揃う（Req 2.1, 2.2）', async () => {
		mockBuildImpressionPart.mockImplementation(async (persona, _turns, _personas, sortOrder) =>
			persona.id === 'p2' ? null : { sortOrder, draft: `${persona.id}原本`, final: `${persona.id}編集後` }
		);

		await runImpressionsStep('t1');

		expect(editorial()!.impressions).toEqual({
			p1: { sortOrder: 0, draft: 'p1原本', final: 'p1編集後' }
		});
		expect(editorial()!.impressions!.p2).toBeUndefined();
	});

	it('既に原本のある参加者は二重生成しない（run 内リトライ保護・Req 5.2）', async () => {
		holder.mock!.store.set('topics/t1/editorial/0', {
			intro: { draft: null, final: null },
			outro: { draft: null, final: null },
			impressions: { p1: { sortOrder: 0, draft: '既存p1原本', final: '既存p1編集後' } }
		});
		mockBuildImpressionPart.mockImplementation(async (persona, _turns, _personas, sortOrder) => ({
			sortOrder,
			draft: `${persona.id}原本`,
			final: `${persona.id}編集後`
		}));

		await runImpressionsStep('t1');

		// p1 はスキップ（既存維持）、p2 のみ新規生成
		expect(mockBuildImpressionPart).toHaveBeenCalledTimes(1);
		expect(editorial()!.impressions!.p1).toEqual({
			sortOrder: 0,
			draft: '既存p1原本',
			final: '既存p1編集後'
		});
		expect(editorial()!.impressions!.p2).toEqual({ sortOrder: 1, draft: 'p2原本', final: 'p2編集後' });
	});
});
