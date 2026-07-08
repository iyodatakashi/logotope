import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Persona } from '../../../types/persona.types.js';
import type { DebateState } from '../../../types/debate.types.js';
import type { DebateTurn, TurnGenerationContext } from '../../../types/turn.types.js';
import type { Chapter } from '../../../types/chapter.types.js';

// 傾聴（evaluateEngagements）→ 気づき永続（appendAwareness）→ 発言消費（generateTurn）の結合テスト。
// 永続層（Firestore）と LLM のみモックし、engagement / awareness / persona-agent / prompt-formatters は実体を使う。
// 同一 persona 参照を通じて、検出した気づきが同ターンの発言プロンプトへ反映されることを検証する（3.1〜3.3）。

vi.mock('ai', () => ({
	generateText: vi.fn(),
	generateObject: vi.fn(),
	jsonSchema: (schema: unknown) => schema,
	stepCountIs: vi.fn((n: number) => n),
	Output: { object: vi.fn(() => ({})) }
}));

vi.mock('../../../llm/models.js', () => ({ sonnet: 'mock-model' }));
vi.mock('../../../search/search-service.js', () => ({
	isSearchAvailable: vi.fn(() => false),
	executeSearch: vi.fn()
}));

const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ update: mockUpdate, set: mockSet }));
vi.mock('firebase-admin/firestore', () => ({
	getFirestore: vi.fn(() => ({ doc: mockDoc })),
	Timestamp: { now: () => 'TS' },
	FieldValue: { arrayUnion: (...v: unknown[]) => v[0] }
}));

vi.mock('nanoid', () => ({ nanoid: () => 'aw-1' }));

import { evaluateEngagements } from '../../../pipeline/debate/engagement.js';
import { generateTurn } from '../../../agents/persona-agent.js';

const makePersona = (id: string, name: string, over: Partial<Persona> = {}): Persona => ({
	id,
	topicId: 't1',
	name,
	age: 40,
	occupation: '会社員',
	stakeholderRole: '市民',
	specificRole: '市民',
	background: '背景',
	interests: '関心',
	nationality: '日本',
	engagementLevel: 'moderate',
	approved: true,
	sortOrder: 0,
	...over
});

const makeTurn = (id: string, personaId: string): DebateTurn => ({
	id,
	speakerType: 'persona',
	personaId,
	content: '直前の発言',
	speechMode: 'opinion',
	createdAt: ''
});

const makeState = (over: Partial<DebateState> = {}): DebateState => ({
	turns: [],
	lastSpeakerId: undefined,
	silenceMap: new Map(),
	speakCount: new Map(),
	queuedIntents: new Map(),
	agenda: [],
	...over
});

const makeChapter = (): Chapter => ({ id: 'ch1', title: 'テスト章', agenda: [] });

describe('傾聴→永続→消費の同ターン反映（結合）', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('傾聴で検出した気づきが同一 persona 参照で同ターンの発言プロンプトに反映され、信念は不変', async () => {
		const aiMod = await import('ai');
		// 傾聴: p1 が reception の気づきを検出する
		vi.mocked(aiMod.generateObject).mockResolvedValue({
			object: {
				score: 3,
				mode: 'opinion',
				intentSummary: null,
				awareness: {
					kind: 'reception',
					content: '在宅の負担という視点は一理ある',
					sourceTurnId: '1'
				}
			}
		} as never);

		const p1 = makePersona('p1', '田中', {
			beliefs: [
				{ id: 'b0', version: 0, content: '対面勤務が基本という信念', createdAt: 'TS' as never }
			]
		});
		const p2 = makePersona('p2', '佐藤');
		const personas = [p1, p2];
		// 直前話者を p2 にして p1 を傾聴評価の対象にする
		const chapterTurns = [makeTurn('t1', 'p2')];
		const state = makeState({ turns: [...chapterTurns], lastSpeakerId: 'p2' });

		const engagements = await evaluateEngagements({
			topicId: 't1',
			chapterId: 'ch1',
			personas,
			state,
			chapterTurns
		});

		// 気づきが同一 persona の in-memory awarenesses へ追記されている（話者選択の前に完了）
		expect(p1.awarenesses).toHaveLength(1);
		expect(p1.awarenesses?.[0]).toMatchObject({
			kind: 'reception',
			content: '在宅の負担という視点は一理ある',
			triggeredByTurnId: 't1'
		});

		// 同じ p1 参照で発言生成し、プロンプトを捕捉する
		const captured: unknown[] = [];
		vi.mocked(aiMod.generateText).mockImplementation(async (args) => {
			captured.push(args);
			return { output: { content: '発言' }, steps: [] } as never;
		});

		const context: TurnGenerationContext = {
			chapterTurns,
			chapter: makeChapter(),
			otherPersonas: [{ id: 'p2', name: '佐藤' }]
		};
		const p1Engagement = engagements.find((e) => e.personaId === 'p1')!;
		const result = await generateTurn(p1, context, p1Engagement, personas);

		expect(result.ok).toBe(true);
		const call = captured[0] as { system: unknown; messages: Array<{ content: string }> };
		// 直前に得た気づきが揮発部（user）に反映される
		expect(call.messages[0].content).toContain('在宅の負担という視点は一理ある');
		// 信念は system の主軸として不変（気づきで上書きされない）。
		// claude 経路では system は cacheControl 付き SystemModelMessage（.content に安定コンテキスト）。
		const systemText =
			typeof call.system === 'string' ? call.system : (call.system as { content: string }).content;
		expect(systemText).toContain('対面勤務が基本という信念');
		// 発言結果は気づき・信念変化を出力しない（消費のみ）
		expect(result.ok && result.value).not.toHaveProperty('awareness');
		expect(result.ok && result.value).not.toHaveProperty('beliefChange');
	});
});
