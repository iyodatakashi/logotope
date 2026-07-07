import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../../../types/persona.types.js';

const { mockGenerateImpression, mockEditImpressions, mockGenerateIntro, mockGenerateOutro, mockEditIntro, mockEditOutro } =
	vi.hoisted(() => ({
		mockGenerateImpression: vi.fn(),
		mockEditImpressions: vi.fn(),
		mockGenerateIntro: vi.fn(),
		mockGenerateOutro: vi.fn(),
		mockEditIntro: vi.fn(),
		mockEditOutro: vi.fn()
	}));

vi.mock('../../../agents/persona-agent.js', () => ({ generateImpression: mockGenerateImpression }));
vi.mock('../../../agents/intro-closing-agent.js', () => ({
	generateIntro: mockGenerateIntro,
	generateOutro: mockGenerateOutro
}));
vi.mock('../../../agents/editor-agent.js', () => ({
	editImpressions: mockEditImpressions,
	editIntro: mockEditIntro,
	editOutro: mockEditOutro
}));

import { buildImpressionPart, buildNarrationPart } from '../../../pipeline/editing/element-builders.js';

const persona = { id: 'p1', name: 'p1' } as unknown as Persona;
const ok = <T>(value: T) => ({ ok: true, value }) as const;
const err = () => ({ ok: false, error: { code: 'AI_API_ERROR', message: 'x', retryable: true } }) as const;

beforeEach(() => vi.clearAllMocks());

describe('buildImpressionPart', () => {
	it('原本生成→整えを通し {sortOrder, draft, final} を返す', async () => {
		mockGenerateImpression.mockResolvedValueOnce(ok({ personaId: 'p1', content: '原本' }));
		mockEditImpressions.mockResolvedValueOnce(ok([{ sourceCommentId: 'p1', personaId: 'p1', content: '編集後' }]));

		const part = await buildImpressionPart(persona, [], [persona], 2);
		expect(part).toEqual({ sortOrder: 2, draft: '原本', final: '編集後' });
	});

	it('原本生成を最大3回リトライし、途中成功なら回復する', async () => {
		mockGenerateImpression.mockResolvedValueOnce(err()).mockResolvedValueOnce(ok({ personaId: 'p1', content: '原本' }));
		mockEditImpressions.mockResolvedValueOnce(ok([{ sourceCommentId: 'p1', personaId: 'p1', content: '編集後' }]));

		const part = await buildImpressionPart(persona, [], [persona], 0);
		expect(mockGenerateImpression).toHaveBeenCalledTimes(2);
		expect(part).toEqual({ sortOrder: 0, draft: '原本', final: '編集後' });
	});

	it('原本生成が全滅（3回失敗）なら null（＝欠け）', async () => {
		mockGenerateImpression.mockResolvedValue(err());
		const part = await buildImpressionPart(persona, [], [persona], 0);
		expect(mockGenerateImpression).toHaveBeenCalledTimes(3);
		expect(part).toBeNull();
	});

	it('整えに失敗しても原本を保持し final=null で返す（できる範囲で）', async () => {
		mockGenerateImpression.mockResolvedValueOnce(ok({ personaId: 'p1', content: '原本' }));
		mockEditImpressions.mockResolvedValueOnce(err());

		const part = await buildImpressionPart(persona, [], [persona], 1);
		expect(part).toEqual({ sortOrder: 1, draft: '原本', final: null });
	});
});

describe('buildNarrationPart', () => {
	const input = { digest: {}, topicContext: {} } as never;

	it('intro: 生成→整えを通し {draft, final} を返す', async () => {
		mockGenerateIntro.mockResolvedValueOnce(ok('導入原本'));
		mockEditIntro.mockResolvedValueOnce(ok('導入編集後'));

		const part = await buildNarrationPart('intro', input);
		expect(part).toEqual({ draft: '導入原本', final: '導入編集後' });
		expect(mockGenerateOutro).not.toHaveBeenCalled();
	});

	it('outro: 生成→整えを通し {draft, final} を返す', async () => {
		mockGenerateOutro.mockResolvedValueOnce(ok('締め原本'));
		mockEditOutro.mockResolvedValueOnce(ok('締め編集後'));

		const part = await buildNarrationPart('outro', input);
		expect(part).toEqual({ draft: '締め原本', final: '締め編集後' });
	});

	it('生成失敗なら {draft:null, final:null}', async () => {
		mockGenerateIntro.mockResolvedValueOnce(err());
		const part = await buildNarrationPart('intro', input);
		expect(part).toEqual({ draft: null, final: null });
		expect(mockEditIntro).not.toHaveBeenCalled();
	});

	it('整え失敗なら原本を保持し {draft, final:null}', async () => {
		mockGenerateIntro.mockResolvedValueOnce(ok('導入原本'));
		mockEditIntro.mockResolvedValueOnce(err());
		const part = await buildNarrationPart('intro', input);
		expect(part).toEqual({ draft: '導入原本', final: null });
	});
});
