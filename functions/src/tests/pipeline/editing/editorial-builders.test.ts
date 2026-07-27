import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../../../types/persona.types.js';
import type { EditorialWriter } from '../../../pipeline/editing/editorial-repository.js';

const {
	mockGenerateImpression,
	mockEditImpression,
	mockGenerateIntro,
	mockGenerateOutro,
	mockEditIntro,
	mockEditOutro,
	mockBuildDigest,
	mockReadDigestCache,
	mockWriteDigestCache,
	mockGetTopicContext
} = vi.hoisted(() => ({
	mockGenerateImpression: vi.fn(),
	mockEditImpression: vi.fn(),
	mockGenerateIntro: vi.fn(),
	mockGenerateOutro: vi.fn(),
	mockEditIntro: vi.fn(),
	mockEditOutro: vi.fn(),
	mockBuildDigest: vi.fn(),
	mockReadDigestCache: vi.fn(),
	mockWriteDigestCache: vi.fn(),
	mockGetTopicContext: vi.fn()
}));

vi.mock('../../../agents/persona-agent.js', () => ({ generateImpression: mockGenerateImpression }));
vi.mock('../../../agents/intro-outro-agent.js', () => ({
	generateIntro: mockGenerateIntro,
	generateOutro: mockGenerateOutro
}));
vi.mock('../../../agents/editor-agent.js', () => ({
	editImpression: mockEditImpression,
	editIntro: mockEditIntro,
	editOutro: mockEditOutro
}));
vi.mock('../../../pipeline/debate/debate-digest.js', () => ({ buildDebateDigest: mockBuildDigest }));
vi.mock('../../../pipeline/editing/digest-cache-repository.js', () => ({
	readDigestCache: mockReadDigestCache,
	writeDigestCache: mockWriteDigestCache
}));
vi.mock('../../../pipeline/topics/topic-context.js', () => ({ getTopicContext: mockGetTopicContext }));

import {
	buildImpressionPart,
	buildNarrationPart,
	buildIntroOutroInput
} from '../../../pipeline/editing/editorial-builders.js';

const persona = { id: 'p1', name: 'p1' } as unknown as Persona;
const ok = <T>(value: T) => ({ ok: true, value }) as const;
const err = () => ({ ok: false, error: { code: 'AI_API_ERROR', message: 'x', retryable: true } }) as const;

// 段階書き込みを記録する擬似 writer。呼ばれた順に (op, 内容) を残し、段階遷移を検証する。
type Step = ['markEditorialGenerating'] | ['markEditorialEditing', string] | ['markEditorialFinished', { draft: string | null; final: string | null }];
const recordingWriter = () => {
	const steps: Step[] = [];
	const writer: EditorialWriter = {
		markEditorialGenerating: async () => {
			steps.push(['markEditorialGenerating']);
		},
		markEditorialEditing: async (draft) => {
			steps.push(['markEditorialEditing', draft]);
		},
		markEditorialFinished: async (content) => {
			steps.push(['markEditorialFinished', content]);
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
			['markEditorialGenerating'],
			['markEditorialEditing', '原本'],
			['markEditorialFinished', { draft: '原本', final: '編集後' }]
		]);
	});

	it('原本生成を最大3回リトライし、途中成功なら回復する', async () => {
		mockGenerateImpression.mockResolvedValueOnce(err()).mockResolvedValueOnce(ok({ personaId: 'p1', content: '原本' }));
		mockEditImpression.mockResolvedValueOnce(ok('編集後'));

		const { writer, steps } = recordingWriter();
		await buildImpressionPart(persona, [], [persona], writer);
		expect(mockGenerateImpression).toHaveBeenCalledTimes(2);
		expect(steps.at(-1)).toEqual(['markEditorialFinished', { draft: '原本', final: '編集後' }]);
	});

	it('原本生成が全滅（3回失敗）なら完了（空＝生成失敗）で確定する（begin 後に finish・toEditing なし）', async () => {
		mockGenerateImpression.mockResolvedValue(err());
		const { writer, steps } = recordingWriter();
		await buildImpressionPart(persona, [], [persona], writer);
		expect(mockGenerateImpression).toHaveBeenCalledTimes(3);
		expect(steps).toEqual([['markEditorialGenerating'], ['markEditorialFinished', { draft: null, final: null }]]);
	});

	it('整えに失敗しても原本を保持して完了（編集失敗）で確定する', async () => {
		mockGenerateImpression.mockResolvedValueOnce(ok({ personaId: 'p1', content: '原本' }));
		mockEditImpression.mockResolvedValueOnce(err());

		const { writer, steps } = recordingWriter();
		await buildImpressionPart(persona, [], [persona], writer);
		expect(steps).toEqual([
			['markEditorialGenerating'],
			['markEditorialEditing', '原本'],
			['markEditorialFinished', { draft: '原本', final: null }]
		]);
	});
});

describe('buildNarrationPart（段階書き込み・生成中への切替は呼ばない契約）', () => {
	const input = { digest: {}, topicContext: {} } as never;

	it('生成中への切替（markEditorialGenerating）は呼ばない（呼び出し側が事前に行う契約・R4.1）', async () => {
		mockGenerateIntro.mockResolvedValueOnce(ok('導入原本'));
		mockEditIntro.mockResolvedValueOnce(ok('導入編集後'));

		const { writer, steps } = recordingWriter();
		await buildNarrationPart('intro', input, writer);
		expect(steps.map((step) => step[0])).not.toContain('markEditorialGenerating');
	});

	it('intro: 整え中→完了（編集済み）の順に書く（切替なし）', async () => {
		mockGenerateIntro.mockResolvedValueOnce(ok('導入原本'));
		mockEditIntro.mockResolvedValueOnce(ok('導入編集後'));

		const { writer, steps } = recordingWriter();
		await buildNarrationPart('intro', input, writer);
		expect(steps).toEqual([
			['markEditorialEditing', '導入原本'],
			['markEditorialFinished', { draft: '導入原本', final: '導入編集後' }]
		]);
		expect(mockGenerateOutro).not.toHaveBeenCalled();
	});

	it('outro: 整え中→完了（編集済み）の順に書く', async () => {
		mockGenerateOutro.mockResolvedValueOnce(ok('締め原本'));
		mockEditOutro.mockResolvedValueOnce(ok('締め編集後'));

		const { writer, steps } = recordingWriter();
		await buildNarrationPart('outro', input, writer);
		expect(steps.at(-1)).toEqual(['markEditorialFinished', { draft: '締め原本', final: '締め編集後' }]);
	});

	it('生成失敗なら完了（空＝生成失敗）で確定する（切替・toEditing なし）', async () => {
		mockGenerateIntro.mockResolvedValueOnce(err());
		const { writer, steps } = recordingWriter();
		await buildNarrationPart('intro', input, writer);
		expect(steps).toEqual([['markEditorialFinished', { draft: null, final: null }]]);
		expect(mockEditIntro).not.toHaveBeenCalled();
	});

	it('整え失敗なら原本を保持して完了（編集失敗）で確定する', async () => {
		mockGenerateIntro.mockResolvedValueOnce(ok('導入原本'));
		mockEditIntro.mockResolvedValueOnce(err());
		const { writer, steps } = recordingWriter();
		await buildNarrationPart('intro', input, writer);
		expect(steps).toEqual([
			['markEditorialEditing', '導入原本'],
			['markEditorialFinished', { draft: '導入原本', final: null }]
		]);
	});
});

describe('buildIntroOutroInput（ダイジェストのキャッシュ再利用）', () => {
	const digest = { topicTitle: 'テーマ', chapters: [], personas: [] };

	beforeEach(() => {
		mockGetTopicContext.mockResolvedValue({ topic: 'ctx' });
		mockReadDigestCache.mockResolvedValue(null);
		mockWriteDigestCache.mockResolvedValue(undefined);
	});

	it('キャッシュヒット時は buildDebateDigest を呼ばず、保存済みダイジェストを再利用する（R5.1）', async () => {
		mockReadDigestCache.mockResolvedValueOnce(digest);

		const result = await buildIntroOutroInput('t1');

		expect(mockBuildDigest).not.toHaveBeenCalled();
		expect(mockWriteDigestCache).not.toHaveBeenCalled();
		expect(result).toEqual({ ok: true, value: { digest, topicContext: { topic: 'ctx' } } });
	});

	it('キャッシュミス時は構築し、以後の再利用のために保存してから返す（R5.2）', async () => {
		mockReadDigestCache.mockResolvedValueOnce(null);
		mockBuildDigest.mockResolvedValueOnce(ok(digest));

		const result = await buildIntroOutroInput('t1');

		expect(mockBuildDigest).toHaveBeenCalledWith('t1');
		expect(mockWriteDigestCache).toHaveBeenCalledWith('t1', digest);
		expect(result).toEqual({ ok: true, value: { digest, topicContext: { topic: 'ctx' } } });
	});

	it('ダイジェスト構築失敗は伝播し、保存しない', async () => {
		mockReadDigestCache.mockResolvedValueOnce(null);
		mockBuildDigest.mockResolvedValueOnce(err());

		const result = await buildIntroOutroInput('t1');

		expect(result.ok).toBe(false);
		expect(mockWriteDigestCache).not.toHaveBeenCalled();
	});

	it('キャッシュ read 失敗は通常構築へフォールバックする（ベストエフォート）', async () => {
		mockReadDigestCache.mockRejectedValueOnce(new Error('firestore down'));
		mockBuildDigest.mockResolvedValueOnce(ok(digest));

		const result = await buildIntroOutroInput('t1');

		expect(mockBuildDigest).toHaveBeenCalledWith('t1');
		expect(result).toEqual({ ok: true, value: { digest, topicContext: { topic: 'ctx' } } });
	});

	it('キャッシュ write 失敗でも生成を止めず結果を返す（ベストエフォート）', async () => {
		mockReadDigestCache.mockResolvedValueOnce(null);
		mockBuildDigest.mockResolvedValueOnce(ok(digest));
		mockWriteDigestCache.mockRejectedValueOnce(new Error('firestore down'));

		const result = await buildIntroOutroInput('t1');

		expect(result).toEqual({ ok: true, value: { digest, topicContext: { topic: 'ctx' } } });
	});
});
