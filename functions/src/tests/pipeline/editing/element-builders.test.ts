import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../../../types/persona.types.js';
import type { ElementWriter } from '../../../pipeline/editing/editorial-repository.js';

const { mockGenerateImpression, mockEditImpression, mockGenerateIntro, mockGenerateOutro, mockEditIntro, mockEditOutro } =
	vi.hoisted(() => ({
		mockGenerateImpression: vi.fn(),
		mockEditImpression: vi.fn(),
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
	editImpression: mockEditImpression,
	editIntro: mockEditIntro,
	editOutro: mockEditOutro
}));

import { buildImpressionPart, buildNarrationPart } from '../../../pipeline/editing/element-builders.js';

const persona = { id: 'p1', name: 'p1' } as unknown as Persona;
const ok = <T>(value: T) => ({ ok: true, value }) as const;
const err = () => ({ ok: false, error: { code: 'AI_API_ERROR', message: 'x', retryable: true } }) as const;

// 段階書き込みを記録する擬似 writer。呼ばれた順に (op, 内容) を残し、段階遷移を検証する。
type Step = ['begin'] | ['toEditing', string] | ['finish', { draft: string | null; final: string | null }];
const recordingWriter = () => {
	const steps: Step[] = [];
	const writer: ElementWriter = {
		begin: async () => {
			steps.push(['begin']);
		},
		toEditing: async (draft) => {
			steps.push(['toEditing', draft]);
		},
		finish: async (content) => {
			steps.push(['finish', content]);
		}
	};
	return { writer, steps };
};

beforeEach(() => vi.clearAllMocks());

describe('buildImpressionPart（段階書き込み）', () => {
	it('生成中→原本成功で整え中→整え成功で完了（編集済み）の順に書く', async () => {
		mockGenerateImpression.mockResolvedValueOnce(ok({ personaId: 'p1', content: '原本' }));
		mockEditImpression.mockResolvedValueOnce(ok('編集後'));

		const { writer, steps } = recordingWriter();
		await buildImpressionPart(persona, [], [persona], writer);
		expect(steps).toEqual([
			['begin'],
			['toEditing', '原本'],
			['finish', { draft: '原本', final: '編集後' }]
		]);
	});

	it('原本生成を最大3回リトライし、途中成功なら回復する', async () => {
		mockGenerateImpression.mockResolvedValueOnce(err()).mockResolvedValueOnce(ok({ personaId: 'p1', content: '原本' }));
		mockEditImpression.mockResolvedValueOnce(ok('編集後'));

		const { writer, steps } = recordingWriter();
		await buildImpressionPart(persona, [], [persona], writer);
		expect(mockGenerateImpression).toHaveBeenCalledTimes(2);
		expect(steps.at(-1)).toEqual(['finish', { draft: '原本', final: '編集後' }]);
	});

	it('原本生成が全滅（3回失敗）なら完了（空＝生成失敗）で確定する（begin 後に finish・toEditing なし）', async () => {
		mockGenerateImpression.mockResolvedValue(err());
		const { writer, steps } = recordingWriter();
		await buildImpressionPart(persona, [], [persona], writer);
		expect(mockGenerateImpression).toHaveBeenCalledTimes(3);
		expect(steps).toEqual([['begin'], ['finish', { draft: null, final: null }]]);
	});

	it('整えに失敗しても原本を保持して完了（編集失敗）で確定する', async () => {
		mockGenerateImpression.mockResolvedValueOnce(ok({ personaId: 'p1', content: '原本' }));
		mockEditImpression.mockResolvedValueOnce(err());

		const { writer, steps } = recordingWriter();
		await buildImpressionPart(persona, [], [persona], writer);
		expect(steps).toEqual([
			['begin'],
			['toEditing', '原本'],
			['finish', { draft: '原本', final: null }]
		]);
	});
});

describe('buildNarrationPart（段階書き込み）', () => {
	const input = { digest: {}, topicContext: {} } as never;

	it('intro: 生成中→整え中→完了（編集済み）の順に書く', async () => {
		mockGenerateIntro.mockResolvedValueOnce(ok('導入原本'));
		mockEditIntro.mockResolvedValueOnce(ok('導入編集後'));

		const { writer, steps } = recordingWriter();
		await buildNarrationPart('intro', input, writer);
		expect(steps).toEqual([
			['begin'],
			['toEditing', '導入原本'],
			['finish', { draft: '導入原本', final: '導入編集後' }]
		]);
		expect(mockGenerateOutro).not.toHaveBeenCalled();
	});

	it('outro: 生成中→整え中→完了（編集済み）の順に書く', async () => {
		mockGenerateOutro.mockResolvedValueOnce(ok('締め原本'));
		mockEditOutro.mockResolvedValueOnce(ok('締め編集後'));

		const { writer, steps } = recordingWriter();
		await buildNarrationPart('outro', input, writer);
		expect(steps.at(-1)).toEqual(['finish', { draft: '締め原本', final: '締め編集後' }]);
	});

	it('生成失敗なら完了（空＝生成失敗）で確定する（toEditing なし）', async () => {
		mockGenerateIntro.mockResolvedValueOnce(err());
		const { writer, steps } = recordingWriter();
		await buildNarrationPart('intro', input, writer);
		expect(steps).toEqual([['begin'], ['finish', { draft: null, final: null }]]);
		expect(mockEditIntro).not.toHaveBeenCalled();
	});

	it('整え失敗なら原本を保持して完了（編集失敗）で確定する', async () => {
		mockGenerateIntro.mockResolvedValueOnce(ok('導入原本'));
		mockEditIntro.mockResolvedValueOnce(err());
		const { writer, steps } = recordingWriter();
		await buildNarrationPart('intro', input, writer);
		expect(steps).toEqual([
			['begin'],
			['toEditing', '導入原本'],
			['finish', { draft: '導入原本', final: null }]
		]);
	});
});
