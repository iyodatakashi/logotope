import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
	getPersonas: vi.fn(),
	getTurns: vi.fn(),
	narrationWriter: vi.fn(),
	impressionWriter: vi.fn(),
	buildImpressionPart: vi.fn(),
	buildNarrationPart: vi.fn(),
	buildInput: vi.fn(),
	readRawChapters: vi.fn(),
	runChapterEditStep: vi.fn(),
	finalize: vi.fn(),
	docGet: vi.fn()
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => ({ doc: () => ({ get: h.docGet }) })
}));
vi.mock('../../../pipeline/personas/personas.js', () => ({ getPersonasByTopicId: h.getPersonas }));
vi.mock('../../../pipeline/debate/chapter.js', () => ({ getDebateTurnsByTopicId: h.getTurns }));
vi.mock('../../../pipeline/editing/editorial-repository.js', () => ({
	narrationWriter: h.narrationWriter,
	impressionWriter: h.impressionWriter
}));
vi.mock('../../../pipeline/editing/element-builders.js', () => ({
	buildImpressionPart: h.buildImpressionPart,
	buildNarrationPart: h.buildNarrationPart,
	buildIntroOutroInput: h.buildInput
}));
vi.mock('../../../pipeline/editing/editing-step.js', () => ({
	readRawChapters: h.readRawChapters,
	runChapterEditStep: h.runChapterEditStep
}));
vi.mock('../../../pipeline/editing/editing-lifecycle.js', () => ({ finalizeEditingRun: h.finalize }));

import {
	regenerateImpression,
	regenerateIntro,
	regenerateOutro,
	regenerateChapter
} from '../../../pipeline/editing/regenerate-element.js';

// writer は段階書き込みハンドル。regenerate はどの要素の writer を build に渡すか（と失敗時の finish）だけを担う。
const INTRO_WRITER = { finish: vi.fn() };
const OUTRO_WRITER = { finish: vi.fn() };
const IMPRESSION_WRITER = { tag: 'impression-writer' };

beforeEach(() => {
	vi.clearAllMocks();
	h.getPersonas.mockResolvedValue([
		{ id: 'p1', selected: true },
		{ id: 'p2', selected: true }
	]);
	h.getTurns.mockResolvedValue([{ id: 't1' }]);
	h.buildInput.mockResolvedValue({ ok: true, value: { digest: {}, topicContext: {} } });
	h.narrationWriter.mockImplementation((_t: string, kind: string) =>
		kind === 'intro' ? INTRO_WRITER : OUTRO_WRITER
	);
	h.impressionWriter.mockReturnValue(IMPRESSION_WRITER);
	h.buildImpressionPart.mockResolvedValue(undefined);
	h.buildNarrationPart.mockResolvedValue(undefined);
	h.readRawChapters.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
	h.runChapterEditStep.mockResolvedValue('completed');
	h.finalize.mockResolvedValue('generated');
	h.docGet.mockResolvedValue({ data: () => ({ runId: 'run-1' }) });
});

describe('regenerateImpression', () => {
	it('当該ペルソナの sortOrder で writer を作り、build（段階書き込み）に渡す', async () => {
		await regenerateImpression('t1', 'p2');
		expect(h.impressionWriter).toHaveBeenCalledWith('t1', 'p2', 1);
		expect(h.buildImpressionPart).toHaveBeenCalledWith(
			{ id: 'p2', selected: true },
			[{ id: 't1' }],
			[
				{ id: 'p1', selected: true },
				{ id: 'p2', selected: true }
			],
			IMPRESSION_WRITER
		);
	});

	it('承認済みペルソナに無い personaId は例外（build しない）', async () => {
		await expect(regenerateImpression('t1', 'pX')).rejects.toThrow();
		expect(h.buildImpressionPart).not.toHaveBeenCalled();
	});

	it('生成失敗（build 内で確定）でも例外を投げない（旧内容は build の begin で破棄済み）', async () => {
		// build は失敗も finished（生成失敗）で確定するため regenerate は解決する。
		await expect(regenerateImpression('t1', 'p1')).resolves.toBeUndefined();
		expect(h.buildImpressionPart).toHaveBeenCalledTimes(1);
	});
});

describe('regenerateIntro / regenerateOutro', () => {
	it('intro: intro の writer を作り build に渡す', async () => {
		await regenerateIntro('t1');
		expect(h.narrationWriter).toHaveBeenCalledWith('t1', 'intro');
		expect(h.buildNarrationPart).toHaveBeenCalledWith('intro', { digest: {}, topicContext: {} }, INTRO_WRITER);
	});

	it('outro: outro の writer を作り build に渡す', async () => {
		await regenerateOutro('t1');
		expect(h.narrationWriter).toHaveBeenCalledWith('t1', 'outro');
		expect(h.buildNarrationPart).toHaveBeenCalledWith('outro', { digest: {}, topicContext: {} }, OUTRO_WRITER);
	});

	it('ダイジェスト構築失敗は throw せず生成失敗（空）で確定する（build しない・旧内容は破棄）', async () => {
		h.buildInput.mockResolvedValueOnce({ ok: false, error: { code: 'NOT_FOUND', message: 'no digest' } });
		await expect(regenerateOutro('t1')).resolves.toBeUndefined();
		expect(h.buildNarrationPart).not.toHaveBeenCalled();
		expect(OUTRO_WRITER.finish).toHaveBeenCalledWith({ draft: null, final: null });
	});

	it('intro もダイジェスト失敗時は生成失敗（空）で確定する', async () => {
		h.buildInput.mockResolvedValueOnce({ ok: false, error: { code: 'NOT_FOUND', message: 'no digest' } });
		await expect(regenerateIntro('t1')).resolves.toBeUndefined();
		expect(h.buildNarrationPart).not.toHaveBeenCalled();
		expect(INTRO_WRITER.finish).toHaveBeenCalledWith({ draft: null, final: null });
	});
});

describe('regenerateChapter', () => {
	it('章を再編集し、現行 runId で完了状態を再評価する', async () => {
		await regenerateChapter('t1', 'c2');
		expect(h.runChapterEditStep).toHaveBeenCalledWith('t1', 1, '');
		expect(h.finalize).toHaveBeenCalledWith('t1', 'run-1');
	});

	it('存在しない chapterId は例外', async () => {
		await expect(regenerateChapter('t1', 'cX')).rejects.toThrow();
		expect(h.runChapterEditStep).not.toHaveBeenCalled();
	});

	it('再編集が completed にならなければ例外（finalize は再評価のため呼ぶ）', async () => {
		h.runChapterEditStep.mockResolvedValueOnce('failed');
		await expect(regenerateChapter('t1', 'c1')).rejects.toThrow();
		expect(h.finalize).toHaveBeenCalledWith('t1', 'run-1');
	});
});
