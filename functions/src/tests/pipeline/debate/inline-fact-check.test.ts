import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCheckContent } = vi.hoisted(() => ({ mockCheckContent: vi.fn() }));
vi.mock('../../../pipeline/fact-check/fact-check-runner.js', () => ({
	checkContent: mockCheckContent
}));

const { mockGenerateTurn } = vi.hoisted(() => ({ mockGenerateTurn: vi.fn() }));
vi.mock('../../../agents/persona-agent.js', () => ({
	generateTurn: mockGenerateTurn
}));

import { verifyAndReviseDraft } from '../../../pipeline/debate/inline-fact-check.js';
import { INLINE_FACT_CHECK_TIMEOUT_MS } from '../../../constants/debate.constants.js';
import type { PersonaReply, Engagement } from '../../../types/debate.types.js';
import type { Persona } from '../../../types/persona.types.js';
import type { TurnGenerationContext } from '../../../types/turn.types.js';
import type { FactCheckContext, FactCheckFinding } from '../../../types/fact-check.types.js';
import type { Chapter } from '../../../types/chapter.types.js';

const persona = { id: 'p1', name: '田中太郎' } as Persona;
const personas: ReadonlyArray<Persona> = [persona];
const chapter = { id: 'ch1', title: '章', focusQuestion: 'Q', discussionPoints: [] } as Chapter;
const context: TurnGenerationContext = { chapterTurns: [], chapter };
const factCheckContext: FactCheckContext = {
	topicTitle: 'T',
	chapterTitle: '章',
	focusQuestion: 'Q',
	currentDate: '2026年6月25日'
};
const engagement: Engagement = { personaId: 'p1', score: 4, mode: 'opinion' };

const draft: PersonaReply = {
	content: '日本の人口は2億人である。',
	speechMode: 'opinion',
	beliefChange: null,
	targetPersonaId: 'p2'
};

const makeFinding = (overrides: Partial<FactCheckFinding> = {}): FactCheckFinding => ({
	id: 'f1',
	turnId: '',
	speakerType: 'persona',
	claim: '日本の人口は2億人である',
	verdict: 'incorrect',
	correction: '約1.2億人である',
	reason: '統計と矛盾',
	sources: [],
	...overrides
});

const callVerify = () =>
	verifyAndReviseDraft({ draft, persona, context, factCheckContext, engagement, personas });

beforeEach(() => {
	vi.clearAllMocks();
});

describe('verifyAndReviseDraft', () => {
	it('修正対象の指摘が無ければドラフトをそのまま採用する（checked / revised:false / findings:[]）', async () => {
		mockCheckContent.mockResolvedValue({ ok: true, value: [] });
		const result = await callVerify();
		expect(result.reply).toBe(draft);
		expect(result.trace).toEqual({ status: 'checked', revised: false, findings: [] });
		expect(mockGenerateTurn).not.toHaveBeenCalled();
	});

	it('指摘があれば1回だけ再生成し、再生成発言＋補正前ドラフトを含むトレースを返す（checked / revised:true）', async () => {
		const findings = [makeFinding()];
		mockCheckContent.mockResolvedValue({ ok: true, value: findings });
		const revised: PersonaReply = {
			content: '補正後の発言',
			beliefChange: null,
			targetPersonaId: 'p3'
		};
		mockGenerateTurn.mockResolvedValue({ ok: true, value: revised });

		const result = await callVerify();

		expect(result.reply).toBe(revised);
		expect(result.trace.status).toBe('checked');
		expect(result.trace.revised).toBe(true);
		expect(result.trace.findings).toEqual(findings);
		expect(result.trace.originalContent).toBe(draft.content);
		expect(mockGenerateTurn).toHaveBeenCalledTimes(1);
	});

	it('再生成には指摘を factCheckFeedback として context に載せ替えて渡す', async () => {
		mockCheckContent.mockResolvedValue({
			ok: true,
			value: [makeFinding({ verdict: 'unverifiable', correction: '' })]
		});
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '補正後', beliefChange: null }
		});

		await callVerify();

		const [passedPersona, passedContext, passedEngagement, passedPersonas] =
			mockGenerateTurn.mock.calls[0];
		expect(passedPersona).toBe(persona);
		expect(passedEngagement).toBe(engagement);
		expect(passedPersonas).toBe(personas);
		expect(passedContext.factCheckFeedback).toEqual([
			{
				claim: '日本の人口は2億人である',
				verdict: 'unverifiable',
				correction: '',
				reason: '統計と矛盾'
			}
		]);
	});

	it('検証エラー時はドラフトを未補正で採用する（unverified / revised:false）', async () => {
		mockCheckContent.mockResolvedValue({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'x', retryable: true }
		});
		const result = await callVerify();
		expect(result.reply).toBe(draft);
		expect(result.trace).toEqual({ status: 'unverified', revised: false, findings: [] });
		expect(mockGenerateTurn).not.toHaveBeenCalled();
	});

	it('検証コアが例外を投げても伝播させず未補正で採用する', async () => {
		mockCheckContent.mockRejectedValue(new Error('boom'));
		const result = await callVerify();
		expect(result.reply).toBe(draft);
		expect(result.trace.status).toBe('unverified');
	});

	it('再生成エラー時はドラフトを採用し、検出済み指摘を記録する（checked / revised:false / findings あり）', async () => {
		const findings = [makeFinding()];
		mockCheckContent.mockResolvedValue({ ok: true, value: findings });
		mockGenerateTurn.mockResolvedValue({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'x', retryable: true }
		});

		const result = await callVerify();

		expect(result.reply).toBe(draft);
		expect(result.trace.status).toBe('checked');
		expect(result.trace.revised).toBe(false);
		expect(result.trace.findings).toEqual(findings);
		expect(result.trace.originalContent).toBeUndefined();
	});

	it('検証コアにドラフト本文・発言モード・話者種別（persona）・文脈を渡す', async () => {
		mockCheckContent.mockResolvedValue({ ok: true, value: [] });
		await callVerify();
		const [input, passedContext] = mockCheckContent.mock.calls[0];
		expect(input.content).toBe(draft.content);
		expect(input.speechMode).toBe('opinion');
		expect(input.speakerType).toBe('persona');
		expect(passedContext).toBe(factCheckContext);
	});

	it('検証は最大1回・再生成は最大1回（再生成後の再検証はしない）', async () => {
		mockCheckContent.mockResolvedValue({ ok: true, value: [makeFinding()] });
		mockGenerateTurn.mockResolvedValue({
			ok: true,
			value: { content: '補正後', beliefChange: null }
		});
		await callVerify();
		expect(mockCheckContent).toHaveBeenCalledTimes(1);
		expect(mockGenerateTurn).toHaveBeenCalledTimes(1);
	});
});

describe('verifyAndReviseDraft タイムアウト', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('上限時間を超えたら未補正で採用する（unverified）', async () => {
		mockCheckContent.mockReturnValue(new Promise(() => {})); // 解決しない
		const promise = callVerify();
		await vi.advanceTimersByTimeAsync(INLINE_FACT_CHECK_TIMEOUT_MS);
		const result = await promise;
		expect(result.reply).toBe(draft);
		expect(result.trace.status).toBe('unverified');
		expect(mockGenerateTurn).not.toHaveBeenCalled();
	});
});
