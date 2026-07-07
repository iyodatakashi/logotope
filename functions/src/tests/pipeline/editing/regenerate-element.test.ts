import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
	getPersonas: vi.fn(),
	getTurns: vi.fn(),
	setIntro: vi.fn(),
	setOutro: vi.fn(),
	setImpression: vi.fn(),
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
	setIntro: h.setIntro,
	setOutro: h.setOutro,
	setImpression: h.setImpression
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

beforeEach(() => {
	vi.clearAllMocks();
	h.getPersonas.mockResolvedValue([
		{ id: 'p1', approved: true },
		{ id: 'p2', approved: true }
	]);
	h.getTurns.mockResolvedValue([{ id: 't1' }]);
	h.buildInput.mockResolvedValue({ ok: true, value: { digest: {}, topicContext: {} } });
	h.readRawChapters.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
	h.runChapterEditStep.mockResolvedValue('completed');
	h.finalize.mockResolvedValue('generated');
	h.docGet.mockResolvedValue({ data: () => ({ runId: 'run-1' }) });
});

describe('regenerateImpression', () => {
	it('原本生成→整え→setImpression（当該ペルソナのみ）で作り直す', async () => {
		h.buildImpressionPart.mockResolvedValueOnce({ sortOrder: 1, draft: '原本', final: '編集後' });
		await regenerateImpression('t1', 'p2');
		expect(h.buildImpressionPart).toHaveBeenCalledWith(
			{ id: 'p2', approved: true },
			[{ id: 't1' }],
			[
				{ id: 'p1', approved: true },
				{ id: 'p2', approved: true }
			],
			1
		);
		expect(h.setImpression).toHaveBeenCalledWith('t1', 'p2', {
			sortOrder: 1,
			draft: '原本',
			final: '編集後'
		});
	});

	it('承認済みペルソナに無い personaId は例外', async () => {
		await expect(regenerateImpression('t1', 'pX')).rejects.toThrow();
		expect(h.setImpression).not.toHaveBeenCalled();
	});

	it('生成全滅（null）は例外を送出し保存しない', async () => {
		h.buildImpressionPart.mockResolvedValueOnce(null);
		await expect(regenerateImpression('t1', 'p1')).rejects.toThrow();
		expect(h.setImpression).not.toHaveBeenCalled();
	});

	it('原本のみで整え失敗（final=null）も例外を送出し保存しない', async () => {
		h.buildImpressionPart.mockResolvedValueOnce({ sortOrder: 0, draft: '原本', final: null });
		await expect(regenerateImpression('t1', 'p1')).rejects.toThrow();
		expect(h.setImpression).not.toHaveBeenCalled();
	});
});

describe('regenerateIntro / regenerateOutro', () => {
	it('intro: 生成→整え→setIntro', async () => {
		h.buildNarrationPart.mockResolvedValueOnce({ draft: '導入原本', final: '導入編集後' });
		await regenerateIntro('t1');
		expect(h.buildNarrationPart).toHaveBeenCalledWith('intro', { digest: {}, topicContext: {} });
		expect(h.setIntro).toHaveBeenCalledWith('t1', { draft: '導入原本', final: '導入編集後' });
	});

	it('outro: 生成→整え→setOutro', async () => {
		h.buildNarrationPart.mockResolvedValueOnce({ draft: '締め原本', final: '締め編集後' });
		await regenerateOutro('t1');
		expect(h.setOutro).toHaveBeenCalledWith('t1', { draft: '締め原本', final: '締め編集後' });
	});

	it('生成失敗（draft=null）は例外を送出し保存しない', async () => {
		h.buildNarrationPart.mockResolvedValueOnce({ draft: null, final: null });
		await expect(regenerateIntro('t1')).rejects.toThrow();
		expect(h.setIntro).not.toHaveBeenCalled();
	});

	it('原本のみで整え失敗（final=null）も例外を送出し保存しない', async () => {
		h.buildNarrationPart.mockResolvedValueOnce({ draft: '導入原本', final: null });
		await expect(regenerateIntro('t1')).rejects.toThrow();
		expect(h.setIntro).not.toHaveBeenCalled();
	});

	it('ダイジェスト構築失敗は例外', async () => {
		h.buildInput.mockResolvedValueOnce({ ok: false, error: { code: 'NOT_FOUND' } });
		await expect(regenerateOutro('t1')).rejects.toThrow();
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
