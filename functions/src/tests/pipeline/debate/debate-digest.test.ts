import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChapterEntry } from '../../../types/chapter.types.js';
import type { Persona } from '../../../types/persona.types.js';
import type { Topic } from '../../../types/topic.types.js';
import type { Result, PipelineError } from '../../../types/common.types.js';

vi.mock('../../../agents/debate-digest-agent.js', () => ({
	summarizeChapter: vi.fn()
}));
vi.mock('../../../pipeline/debate/chapter.js', () => ({
	getChaptersByTopicId: vi.fn()
}));
vi.mock('../../../pipeline/personas/personas.js', () => ({
	getPersonasByTopicId: vi.fn()
}));
vi.mock('../../../pipeline/topics/topics.js', () => ({
	getTopicById: vi.fn()
}));

const TS = 'TS' as unknown as Topic['createdAt'];

const makeChapter = (id: string, index: number, title: string): ChapterEntry => ({
	id,
	chapterIndex: index,
	title,
	discussionPoints: [`論点${index}`],
	turns: [
		{
			id: `${id}-t1`,
			speakerType: 'persona',
			personaId: 'p1',
			content: '発言',
			createdAt: TS
		}
	],
	status: 'completed'
});

const makePersona = (id: string, name: string, approved: boolean): Persona => ({
	id,
	topicId: 't1',
	name,
	age: 40,
	occupation: '職業',
	stakeholderRole: '一般',
	specificRole: '役割',
	background: '',
	interests: '',
	nationality: '日本',
	engagementLevel: 'moderate',
	llmType: 'claude',
	approved,
	sortOrder: 0,
	beliefs: [{ id: 'b0', version: 0, content: `${name}の初期信念`, createdAt: TS }],
	awarenesses: [
		{
			id: 'a1',
			kind: 'reception',
			content: `${name}の気づき`,
			sourcePersonaId: 'p2',
			triggeredByTurnId: 'c1-t1',
			createdAt: TS
		}
	]
});

const okSummary = (text: string): Result<string, PipelineError> => ({ ok: true, value: text });

describe('buildDebateDigest', () => {
	let summarizeChapter: ReturnType<typeof vi.fn>;
	let getChaptersByTopicId: ReturnType<typeof vi.fn>;
	let getPersonasByTopicId: ReturnType<typeof vi.fn>;
	let getTopicById: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		summarizeChapter = vi.mocked(
			(await import('../../../agents/debate-digest-agent.js')).summarizeChapter
		);
		getChaptersByTopicId = vi.mocked(
			(await import('../../../pipeline/debate/chapter.js')).getChaptersByTopicId
		);
		getPersonasByTopicId = vi.mocked(
			(await import('../../../pipeline/personas/personas.js')).getPersonasByTopicId
		);
		getTopicById = vi.mocked((await import('../../../pipeline/topics/topics.js')).getTopicById);
	});

	it('全章の要約成功で消費者中立の DebateDigest を組み立てる', async () => {
		getTopicById.mockResolvedValue({ id: 't1', title: 'テーマ名', createdAt: TS, updatedAt: TS });
		getChaptersByTopicId.mockResolvedValue([
			makeChapter('c1', 0, '第1章'),
			makeChapter('c2', 1, '第2章')
		]);
		getPersonasByTopicId.mockResolvedValue([makePersona('p1', '田中', true)]);
		summarizeChapter
			.mockResolvedValueOnce(okSummary('第1章の中立要約'))
			.mockResolvedValueOnce(okSummary('第2章の中立要約'));

		const { buildDebateDigest } = await import('../../../pipeline/debate/debate-digest.js');
		const result = await buildDebateDigest('t1');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.topicTitle).toBe('テーマ名');
			expect(result.value.chapters).toEqual([
				{ title: '第1章', discussionPoints: ['論点0'], summary: '第1章の中立要約' },
				{ title: '第2章', discussionPoints: ['論点1'], summary: '第2章の中立要約' }
			]);
		}
		expect(summarizeChapter).toHaveBeenCalledTimes(2);
	});

	it('承認済みペルソナのみを stance（初期信念）・beliefShifts（気づき）付きで含める', async () => {
		getTopicById.mockResolvedValue({ id: 't1', title: 'テーマ名', createdAt: TS, updatedAt: TS });
		getChaptersByTopicId.mockResolvedValue([makeChapter('c1', 0, '第1章')]);
		getPersonasByTopicId.mockResolvedValue([
			makePersona('p1', '田中', true),
			makePersona('p2', '未承認', false)
		]);
		summarizeChapter.mockResolvedValue(okSummary('要約'));

		const { buildDebateDigest } = await import('../../../pipeline/debate/debate-digest.js');
		const result = await buildDebateDigest('t1');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.personas).toEqual([
				{ personaId: 'p1', name: '田中', stance: '田中の初期信念', beliefShifts: ['田中の気づき'] }
			]);
		}
		// 未承認ペルソナは要約プロンプトにも渡さない
		const passedPersonas = summarizeChapter.mock.calls[0][0].personas as Persona[];
		expect(passedPersonas.map((p) => p.id)).toEqual(['p1']);
	});

	it('1章でも要約が失敗すれば PipelineError を返す（部分成功なし）', async () => {
		getTopicById.mockResolvedValue({ id: 't1', title: 'テーマ名', createdAt: TS, updatedAt: TS });
		getChaptersByTopicId.mockResolvedValue([
			makeChapter('c1', 0, '第1章'),
			makeChapter('c2', 1, '第2章')
		]);
		getPersonasByTopicId.mockResolvedValue([makePersona('p1', '田中', true)]);
		summarizeChapter.mockResolvedValueOnce(okSummary('第1章の要約')).mockResolvedValueOnce({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'down', retryable: true }
		});

		const { buildDebateDigest } = await import('../../../pipeline/debate/debate-digest.js');
		const result = await buildDebateDigest('t1');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('AI_API_ERROR');
		}
	});

	it('トピックが存在しなければ NOT_FOUND を返す', async () => {
		getTopicById.mockResolvedValue(null);
		getChaptersByTopicId.mockResolvedValue([makeChapter('c1', 0, '第1章')]);
		getPersonasByTopicId.mockResolvedValue([makePersona('p1', '田中', true)]);
		summarizeChapter.mockResolvedValue(okSummary('要約'));

		const { buildDebateDigest } = await import('../../../pipeline/debate/debate-digest.js');
		const result = await buildDebateDigest('t1');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('NOT_FOUND');
		}
	});
});
