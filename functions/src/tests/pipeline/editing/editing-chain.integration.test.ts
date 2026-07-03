/**
 * Task 8.5: 編集チェーンとリセット整合の統合テスト
 * - AI 層（generateObject）とタスク投入（enqueueEditingStep）のみモックし、
 *   編集パイプライン・討論リセット経路の本物を最小インメモリ Firestore 上で通しで動かす。
 * - 検証: 編集開始→章チェーン→コメント→完了（generated）／討論 reset での編集成果物破棄／再実行時の即時破棄。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { EditingStepPayload } from '../../../pipeline/editing/enqueue-editing-step.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined,
		queue: [] as EditingStepPayload[]
	}
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' },
	FieldValue: {
		delete: () => holder.mock!.FieldValue.delete(),
		arrayUnion: (...v: unknown[]) => holder.mock!.FieldValue.arrayUnion(...v)
	}
}));

vi.mock('ai', () => ({ generateObject: vi.fn() }));
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: vi.fn(() => 'mock-model') }));
vi.mock('../../../constants/ai.constants.js', () => ({ AI_MODELS: { SONNET: 'sonnet' } }));

// タスク投入をインメモリキューに置き換え、テスト側でチェーンを駆動する。
vi.mock('../../../pipeline/editing/enqueue-editing-step.js', () => ({
	enqueueEditingStep: vi.fn(async (payload: EditingStepPayload) => {
		holder.queue.push(payload);
	})
}));

import { generateObject } from 'ai';
import { advanceEditing } from '../../../pipeline/editing/editing-orchestrator.js';
import { startEditingRun } from '../../../pipeline/editing/editing-lifecycle.js';
import { resetDebate } from '../../../pipeline/debate/debate-lifecycle.js';
import { clearEditedArtifact } from '../../../pipeline/editing/edited-repository.js';

const mockGenerateObject = vi.mocked(generateObject);

const editedChapterPath = (chapterId: string) => `topics/t1/editedChapters/${chapterId}`;
const EDITED_COMMENTS_PATH = 'topics/t1/editedPostDebateComments/0';

const seedTopic = () => {
	const mock = holder.mock!;
	mock.store.set('topics/t1', { phase: 'editing', phaseStatus: 'not_started' });
	mock.store.set('topics/t1/personas/p1', {
		topicId: 't1',
		name: 'p1',
		approved: true,
		sortOrder: 0,
		stakeholderRole: '一般'
	});
	mock.store.set('topics/t1/chapters/c1', {
		chapterIndex: 0,
		title: '第1章',
		discussionPoints: ['論点'],
		turns: [
			{ id: 't1a', speakerType: 'persona', personaId: 'p1', content: '発言1a', createdAt: 'TS' },
			{ id: 't1b', speakerType: 'persona', personaId: 'p1', content: '発言1b', createdAt: 'TS' }
		]
	});
	mock.store.set('topics/t1/chapters/c2', {
		chapterIndex: 1,
		title: '第2章',
		discussionPoints: ['論点'],
		turns: [
			{ id: 't2a', speakerType: 'persona', personaId: 'p1', content: '発言2a', createdAt: 'TS' }
		]
	});
	mock.store.set('topics/t1/postDebateComments/0', {
		comments: [{ id: 'rc1', personaId: 'p1', content: '冗長な感想', sortOrder: 0 }]
	});
};

// enqueue されたステップを FIFO で消化し、編集チェーンを終端まで駆動する。
const drainQueue = async () => {
	let guard = 0;
	while (holder.queue.length > 0) {
		if (guard++ > 50) throw new Error('drain guard tripped');
		const payload = holder.queue.shift()!;
		await advanceEditing(payload);
	}
};

beforeEach(() => {
	holder.mock = createFirestoreMock();
	holder.queue = [];
	mockGenerateObject.mockReset();
});

describe('編集チェーンの通し実行', () => {
	it('編集開始→章チェーン→コメント→完了（generated）まで通しで到達する', async () => {
		seedTopic();
		// c1 → c2 → comments の順に呼ばれる（チェーンは逐次）。
		mockGenerateObject
			.mockResolvedValueOnce({
				object: {
					turns: [
						{
							sourceTurnIds: ['t1a', 't1b'],
							speakerType: 'persona',
							personaId: 'p1',
							content: '第1章の編集後'
						}
					]
				}
			} as never)
			.mockResolvedValueOnce({
				object: {
					turns: [
						{
							sourceTurnIds: ['t2a'],
							speakerType: 'persona',
							personaId: 'p1',
							content: '第2章の編集後'
						}
					]
				}
			} as never)
			.mockResolvedValueOnce({
				object: { comments: [{ sourceCommentId: 'rc1', content: '読みやすい感想' }] }
			} as never);

		const runId = await startEditingRun('t1');
		holder.queue.push({ topicId: 't1', runId, stepKind: 'chapter', chapterIndex: 0 });
		await drainQueue();

		const c1 = holder.mock!.store.get(editedChapterPath('c1'));
		const c2 = holder.mock!.store.get(editedChapterPath('c2'));
		expect(c1).toMatchObject({ status: 'completed' });
		expect(c2).toMatchObject({ status: 'completed' });
		expect((c1!.turns as Array<{ content: string }>)[0].content).toBe('第1章の編集後');

		const comments = holder.mock!.store.get(EDITED_COMMENTS_PATH);
		expect((comments!.comments as Array<{ sourceCommentId: string }>)[0].sourceCommentId).toBe(
			'rc1'
		);

		expect(holder.mock!.store.get('topics/t1')).toMatchObject({ phaseStatus: 'generated' });
	});

	it('一部章が構造検証に失敗すると全体は generated とならず stopped に留まる', async () => {
		seedTopic();
		// c1 は正常、c2 は原本に無い ID を指し検証不合格 → failed。
		mockGenerateObject
			.mockResolvedValueOnce({
				object: {
					turns: [
						{
							sourceTurnIds: ['t1a', 't1b'],
							speakerType: 'persona',
							personaId: 'p1',
							content: '第1章の編集後'
						}
					]
				}
			} as never)
			.mockResolvedValueOnce({
				object: {
					turns: [
						{ sourceTurnIds: ['ghost'], speakerType: 'persona', personaId: 'p1', content: 'x' }
					]
				}
			} as never)
			.mockResolvedValueOnce({
				object: { comments: [{ sourceCommentId: 'rc1', content: '読みやすい感想' }] }
			} as never);

		const runId = await startEditingRun('t1');
		holder.queue.push({ topicId: 't1', runId, stepKind: 'chapter', chapterIndex: 0 });
		await drainQueue();

		expect(holder.mock!.store.get(editedChapterPath('c1'))).toMatchObject({ status: 'completed' });
		expect(holder.mock!.store.get(editedChapterPath('c2'))).toMatchObject({ status: 'failed' });
		expect(holder.mock!.store.get('topics/t1')).toMatchObject({ phaseStatus: 'stopped' });
	});

	it('原本が空の章はスキップされ、成果物を書かず完了確定（generated）を妨げない', async () => {
		seedTopic();
		// c2 の原本ターンを空にする（原本が存在しない章）。
		holder.mock!.store.set('topics/t1/chapters/c2', {
			chapterIndex: 1,
			title: '第2章',
			discussionPoints: ['論点'],
			turns: []
		});
		// c1 の章編集 → コメント の2回だけ LLM が呼ばれる（c2 はスキップ）。
		mockGenerateObject
			.mockResolvedValueOnce({
				object: {
					turns: [
						{
							sourceTurnIds: ['t1a', 't1b'],
							speakerType: 'persona',
							personaId: 'p1',
							content: '第1章の編集後'
						}
					]
				}
			} as never)
			.mockResolvedValueOnce({
				object: { comments: [{ sourceCommentId: 'rc1', content: '読みやすい感想' }] }
			} as never);

		const runId = await startEditingRun('t1');
		holder.queue.push({ topicId: 't1', runId, stepKind: 'chapter', chapterIndex: 0 });
		await drainQueue();

		expect(holder.mock!.store.get(editedChapterPath('c1'))).toMatchObject({ status: 'completed' });
		// スキップ章は成果物を書かない
		expect(holder.mock!.store.has(editedChapterPath('c2'))).toBe(false);
		// LLM 呼び出しは c1＋コメントの2回のみ
		expect(mockGenerateObject).toHaveBeenCalledTimes(2);
		// スキップ章があっても全体は generated に到達する
		expect(holder.mock!.store.get('topics/t1')).toMatchObject({ phaseStatus: 'generated' });
	});
});

describe('リセット整合（原本再生成との不整合を残さない）', () => {
	it('討論 reset で編集成果物が破棄される（原本経路の本物を通す）', async () => {
		seedTopic();
		// 既に編集成果物が存在する状態を作る。
		holder.mock!.store.set(editedChapterPath('c1'), {
			chapterIndex: 0,
			status: 'completed',
			turns: []
		});
		holder.mock!.store.set(editedChapterPath('c2'), {
			chapterIndex: 1,
			status: 'completed',
			turns: []
		});
		holder.mock!.store.set(EDITED_COMMENTS_PATH, { comments: [{ id: 'ec1' }] });

		await resetDebate('t1');

		expect(holder.mock!.store.has(editedChapterPath('c1'))).toBe(false);
		expect(holder.mock!.store.has(editedChapterPath('c2'))).toBe(false);
		expect(holder.mock!.store.get(EDITED_COMMENTS_PATH)).toEqual({ comments: [] });
	});

	it('再実行（startEditingRun）で旧成果物が即時破棄され、新世代 runId になる', async () => {
		seedTopic();
		holder.mock!.store.set('topics/t1', { phase: 'editing', phaseStatus: 'stopped', runId: 'old' });
		holder.mock!.store.set(editedChapterPath('c1'), {
			chapterIndex: 0,
			status: 'failed',
			turns: []
		});
		holder.mock!.store.set(EDITED_COMMENTS_PATH, { comments: [{ id: 'ec1' }] });

		const runId = await startEditingRun('t1');

		expect(holder.mock!.store.has(editedChapterPath('c1'))).toBe(false);
		expect(holder.mock!.store.get(EDITED_COMMENTS_PATH)).toEqual({ comments: [] });
		expect(holder.mock!.store.get('topics/t1')).toMatchObject({
			phase: 'editing',
			phaseStatus: 'running',
			runId
		});
		expect(runId).not.toBe('old');
	});

	it('clearEditedArtifact は原本（chapters・postDebateComments）を変更しない', async () => {
		seedTopic();
		holder.mock!.store.set(editedChapterPath('c1'), {
			chapterIndex: 0,
			status: 'completed',
			turns: []
		});

		await clearEditedArtifact('t1');

		// 原本の章・コメントは不変
		expect(holder.mock!.store.get('topics/t1/chapters/c1')).toMatchObject({ chapterIndex: 0 });
		expect((holder.mock!.store.get('topics/t1/chapters/c1')!.turns as unknown[]).length).toBe(2);
		expect(holder.mock!.store.get('topics/t1/postDebateComments/0')).toMatchObject({
			comments: [{ id: 'rc1', personaId: 'p1', content: '冗長な感想', sortOrder: 0 }]
		});
	});
});
