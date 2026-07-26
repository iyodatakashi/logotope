/**
 * 編集チェーンとリセット整合の統合テスト（新チェーン: impressions → chapter → intro-outro）。
 * AI 層（generateObject / generateText）とタスク投入（enqueueEditingStep）のみモックし、
 * 編集パイプライン・討論リセット経路の本物を最小インメモリ Firestore 上で通しで動かす。
 * 記事要素は統合保存 editorial/outputs（導入/締め/所感）＋ editedChapters（本体）へ draft/final で揃う。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { EditingStepPayload } from '../../../pipeline/editing/enqueue-editing-step.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined,
		queue: [] as EditingStepPayload[],
		log: [] as EditingStepPayload[]
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

vi.mock('ai', () => ({ generateObject: vi.fn(), generateText: vi.fn() }));
vi.mock('../../../llm/models.js', () => ({ sonnet: 'mock-model' }));

// LLM リーフ（所感・導入/締めの原本生成→整え）はビルダー単体テストに委ね、ここではチェーン結線・
// 統合保存・完了確定を本物で通す。章編集は generateObject をモックした本物の editChapter＋構造検証を通す。
const { mockBuildImpression, mockBuildNarration, mockBuildInput } = vi.hoisted(() => ({
	mockBuildImpression: vi.fn(),
	mockBuildNarration: vi.fn(),
	mockBuildInput: vi.fn()
}));
vi.mock('../../../pipeline/editing/editorial-builders.js', () => ({
	buildImpressionPart: mockBuildImpression,
	buildNarrationPart: mockBuildNarration,
	buildIntroOutroInput: mockBuildInput
}));

vi.mock('../../../pipeline/editing/enqueue-editing-step.js', () => ({
	enqueueEditingStep: vi.fn(async (payload: EditingStepPayload) => {
		holder.queue.push(payload);
		holder.log.push(payload);
	})
}));

import { generateObject } from 'ai';
import { advanceEditing } from '../../../pipeline/editing/editing-orchestrator.js';
import { startEditingRun } from '../../../pipeline/editing/editing-lifecycle.js';
import { resetDebate } from '../../../pipeline/debate/debate-lifecycle.js';
import { clearEditedArtifact } from '../../../pipeline/editing/edited-repository.js';

const mockGenerateObject = vi.mocked(generateObject);

const editedChapterPath = (chapterId: string) => `topics/t1/editedChapters/${chapterId}`;
const EDITORIAL_PATH = 'topics/t1/editorial/outputs';

const seedTopic = () => {
	const mock = holder.mock!;
	mock.store.set('topics/t1', { phase: 'editing', phaseStatus: 'not_started', title: 'テーマ' });
	mock.store.set('topics/t1/personas/p1', {
		topicId: 't1',
		name: 'p1',
		selected: true,
		sortOrder: 0,
		stakeholderRole: '一般',
	});
	mock.store.set('topics/t1/chapters/c1', {
		chapterIndex: 0,
		title: '第1章',
		agenda: ['論点'],
		turns: [
			{ id: 't1a', speakerType: 'persona', personaId: 'p1', content: '発言1a', createdAt: 'TS' },
			{ id: 't1b', speakerType: 'persona', personaId: 'p1', content: '発言1b', createdAt: 'TS' }
		]
	});
	mock.store.set('topics/t1/chapters/c2', {
		chapterIndex: 1,
		title: '第2章',
		agenda: ['論点'],
		turns: [{ id: 't2a', speakerType: 'persona', personaId: 'p1', content: '発言2a', createdAt: 'TS' }]
	});
};

// 章編集の generateObject をプロンプト内の原本ターンID で振り分ける（本物の editChapter＋構造検証を通す）。
const chapterEdit = (id: string, sourceTurnIds: string[]) =>
	({
		object: { turns: [{ sourceTurnIds, speakerType: 'persona', personaId: 'p1', content: `${id}編集後` }] }
	}) as never;

const seedGenerateObject = () => {
	mockGenerateObject.mockImplementation(async (opts: unknown) => {
		const text = (opts as { messages: Array<{ content: string }> }).messages[0].content;
		if (text.includes('ID:t1a')) return chapterEdit('第1章', ['t1a', 't1b']);
		if (text.includes('ID:t2a')) return chapterEdit('第2章', ['t2a']);
		throw new Error(`unexpected generateObject: ${text.slice(0, 30)}`);
	});
};

const drainQueue = async () => {
	let guard = 0;
	while (holder.queue.length > 0) {
		if (guard++ > 50) throw new Error('drain guard tripped');
		await advanceEditing(holder.queue.shift()!);
	}
};

const editorial = () =>
	holder.mock!.store.get(EDITORIAL_PATH) as {
		intro: { status: string; draft: string | null; final: string | null };
		outro: { status: string; draft: string | null; final: string | null };
		impressions: Record<
			string,
			{ sortOrder: number; status: string; draft: string | null; final: string | null }
		>;
	};

beforeEach(() => {
	holder.mock = createFirestoreMock();
	holder.queue = [];
	holder.log = [];
	mockGenerateObject.mockReset();
	mockBuildImpression.mockReset();
	mockBuildNarration.mockReset();
	mockBuildInput.mockReset();
	// 既定: 所感・導入/締めのビルダーは本物の writer 経由で完了確定する（段階書き込みを finish で代行）。
	mockBuildImpression.mockImplementation(async (_persona, _turns, _personas, writer) => {
		await writer.markEditorialFinished({ draft: '所感原本', final: '所感編集後' });
	});
	mockBuildNarration.mockImplementation(async (_kind, _input, writer) => {
		await writer.markEditorialFinished({ draft: '整えテキスト', final: '整えテキスト' });
	});
	mockBuildInput.mockResolvedValue({ ok: true, value: { digest: {}, topicContext: {} } });
});

describe('編集チェーンの通し実行（impressions → chapter → intro-outro）', () => {
	it('編集開始→所感→章チェーン→導入/締め→完了（generated）まで通しで到達し、記事要素が draft/final で揃う', async () => {
		seedTopic();
		seedGenerateObject();

		const runId = await startEditingRun('t1');
		holder.queue.push({ topicId: 't1', runId, stepKind: 'impressions', chapterIndex: -1 });
		await drainQueue();

		// チェーン順序（先頭 impressions は手動 push のため log 外）
		expect(holder.log.map((p) => p.stepKind)).toEqual(['chapter', 'chapter', 'intro-outro']);

		// 所感が統合保存へ status＋draft/final で揃う
		expect(editorial().impressions.p1).toEqual({ sortOrder: 0, status: 'finished', draft: '所感原本', final: '所感編集後' });
		// 導入・締めが status＋draft/final で揃う
		expect(editorial().intro).toEqual({ status: 'finished', draft: '整えテキスト', final: '整えテキスト' });
		expect(editorial().outro).toEqual({ status: 'finished', draft: '整えテキスト', final: '整えテキスト' });
		// 本体（章）は editedChapters に completed
		expect(holder.mock!.store.get(editedChapterPath('c1'))).toMatchObject({ status: 'completed' });
		expect(holder.mock!.store.get(editedChapterPath('c2'))).toMatchObject({ status: 'completed' });
		// 完了確定
		expect(holder.mock!.store.get('topics/t1')).toMatchObject({ phaseStatus: 'generated' });
	});

	it('一部章が構造検証に失敗すると全体は generated とならず stopped に留まる（他要素は揃う）', async () => {
		seedTopic();
		// c2 は原本に無い ID を指し検証不合格 → failed。
		mockGenerateObject.mockImplementation(async (opts: unknown) => {
			const text = (opts as { messages: Array<{ content: string }> }).messages[0].content;
			if (text.includes('ID:t1a')) return chapterEdit('第1章', ['t1a', 't1b']);
			return chapterEdit('第2章', ['ghost']);
		});

		const runId = await startEditingRun('t1');
		holder.queue.push({ topicId: 't1', runId, stepKind: 'impressions', chapterIndex: -1 });
		await drainQueue();

		expect(holder.mock!.store.get(editedChapterPath('c1'))).toMatchObject({ status: 'completed' });
		expect(holder.mock!.store.get(editedChapterPath('c2'))).toMatchObject({ status: 'failed' });
		// 所感・導入/締めは揃っていても、章の失敗で全体は stopped
		expect(editorial().impressions.p1).toMatchObject({ status: 'finished', final: '所感編集後' });
		expect(holder.mock!.store.get('topics/t1')).toMatchObject({ phaseStatus: 'stopped' });
	});

	it('導入/締めの生成（ダイジェスト）が失敗しても本文・完了確定へ到達し generated（intro/outro は終端スイープで生成失敗に確定）', async () => {
		seedTopic();
		seedGenerateObject();
		// ダイジェスト構築が失敗する状況を模す（intro-outro は best-effort でスキップ）。
		mockBuildInput.mockResolvedValue({ ok: false, error: { code: 'NOT_FOUND' } });

		const runId = await startEditingRun('t1');
		holder.queue.push({ topicId: 't1', runId, stepKind: 'impressions', chapterIndex: -1 });
		await drainQueue();

		// 導入/締めは生成に到達できず、終端スイープで完了（空＝生成失敗）に確定する（生成待ち固着を防ぐ）
		expect(editorial().intro).toEqual({ status: 'finished', draft: null, final: null });
		expect(editorial().outro).toEqual({ status: 'finished', draft: null, final: null });
		// 所感・本文・完了確定は到達
		expect(editorial().impressions.p1).toMatchObject({ status: 'finished', final: '所感編集後' });
		expect(holder.mock!.store.get('topics/t1')).toMatchObject({ phaseStatus: 'generated' });
	});
});

describe('やり直し・リセット整合（全記事の作り直し）', () => {
	it('再実行（startEditingRun）で旧記事（editedChapters ＋ editorial）が即時破棄され、新世代 runId になる', async () => {
		seedTopic();
		holder.mock!.store.set('topics/t1', { phase: 'editing', phaseStatus: 'stopped', runId: 'old' });
		holder.mock!.store.set(editedChapterPath('c1'), { chapterIndex: 0, status: 'failed', turns: [] });
		holder.mock!.store.set(EDITORIAL_PATH, {
			intro: { draft: '旧導入', final: '旧導入編集後' },
			outro: { draft: null, final: null },
			impressions: { p1: { sortOrder: 0, draft: '旧所感', final: '旧所感編集後' } }
		});

		const runId = await startEditingRun('t1');

		expect(holder.mock!.store.has(editedChapterPath('c1'))).toBe(false);
		expect(editorial()).toEqual({
			intro: { status: 'pending', draft: null, final: null },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});
		expect(holder.mock!.store.get('topics/t1')).toMatchObject({
			phase: 'editing',
			phaseStatus: 'running',
			runId
		});
		expect(runId).not.toBe('old');
	});

	it('討論 reset で編集記事（editedChapters ＋ editorial）が破棄される（原本経路の本物を通す）', async () => {
		seedTopic();
		holder.mock!.store.set(editedChapterPath('c1'), { chapterIndex: 0, status: 'completed', turns: [] });
		holder.mock!.store.set(EDITORIAL_PATH, {
			intro: { draft: '導入', final: '導入編集後' },
			outro: { draft: null, final: null },
			impressions: { p1: { sortOrder: 0, draft: '所感', final: '所感編集後' } }
		});

		await resetDebate('t1');

		expect(holder.mock!.store.has(editedChapterPath('c1'))).toBe(false);
		expect(editorial()).toEqual({
			intro: { status: 'pending', draft: null, final: null },
			outro: { status: 'pending', draft: null, final: null },
			impressions: {}
		});
	});

	it('clearEditedArtifact は原本（chapters）を変更しない', async () => {
		seedTopic();
		holder.mock!.store.set(editedChapterPath('c1'), { chapterIndex: 0, status: 'completed', turns: [] });

		await clearEditedArtifact('t1');

		expect(holder.mock!.store.get('topics/t1/chapters/c1')).toMatchObject({ chapterIndex: 0 });
		expect((holder.mock!.store.get('topics/t1/chapters/c1')!.turns as unknown[]).length).toBe(2);
	});
});
