import { describe, it, expect, vi } from 'vitest';
import {
	selectSpeaker,
	shouldQueue,
	shouldSpeak
} from '../../../pipeline/debate/speaker-selection.js';
import {
	QUEUE_THRESHOLD_SCORE,
	SPEAK_THRESHOLD_SCORE
} from '../../../constants/debate.constants.js';
import type { Engagement, QueuedIntent } from '../../../types/debate.types.js';
import type { Persona } from '../../../types/persona.types.js';

describe('shouldQueue / shouldSpeak', () => {
	it('QUEUE_THRESHOLD_SCORE 以上はキューに積むべき', () => {
		expect(shouldQueue({ score: QUEUE_THRESHOLD_SCORE })).toBe(true);
		expect(shouldQueue({ score: QUEUE_THRESHOLD_SCORE + 1 })).toBe(true);
	});

	it('QUEUE_THRESHOLD_SCORE 未満はキューに積まない（境界）', () => {
		expect(shouldQueue({ score: QUEUE_THRESHOLD_SCORE - 1 })).toBe(false);
	});

	it('shouldSpeak は1人でも SPEAK_THRESHOLD_SCORE 以上がいれば true', () => {
		expect(shouldSpeak([{ score: 2 }, { score: SPEAK_THRESHOLD_SCORE }])).toBe(true);
	});

	it('shouldSpeak は全員が SPEAK_THRESHOLD_SCORE 未満なら false', () => {
		expect(shouldSpeak([{ score: 1 }, { score: SPEAK_THRESHOLD_SCORE - 1 }])).toBe(false);
	});

	it('shouldSpeak は空集合で false', () => {
		expect(shouldSpeak([])).toBe(false);
	});
});

const makePersonas = (ids: string[]): Persona[] =>
	ids.map((id) => ({
		id,
		topicId: 'topic1',
		name: id,
		age: 30,
		occupation: '会社員',
		stakeholderRole: '市民',
		specificRole: '市民',
		background: '',
		interests: '',
		nationality: '日本',
		engagementLevel: 'moderate' as const,
		llmType: 'claude' as const,
		approved: true,
		sortOrder: 0
	}));

const makeState = (silenceMap: Map<string, number> = new Map()) => ({
	turns: [],
	lastSpeakerId: undefined as string | undefined,
	silenceMap,
	speakCount: new Map<string, number>(),
	queuedIntents: new Map<string, QueuedIntent[]>(),
	agenda: []
});

describe('selectSpeaker - モード優先度タイブレーク（スコア・沈黙が同点）', () => {
	const personas = makePersonas(['p1', 'p2', 'p3']);

	it('fact > question > opinion の優先順で選ぶ（factが勝つ）', () => {
		const engagements: Engagement[] = [
			{ personaId: 'p1', score: 4, mode: 'opinion' },
			{ personaId: 'p2', score: 4, mode: 'fact' },
			{ personaId: 'p3', score: 4, mode: 'question', intentSummary: '聞きたい' }
		];
		const result = selectSpeaker({
			targetPersona: undefined,

			engagements,
			state: makeState(),
			personas
		});
		expect(result.personaId).toBe('p2');
	});

	it('fact > question > opinion の優先順で選ぶ（questionがopinionに勝つ）', () => {
		const engagements: Engagement[] = [
			{ personaId: 'p1', score: 4, mode: 'opinion' },
			{ personaId: 'p2', score: 4, mode: 'question', intentSummary: '聞きたい' }
		];
		const result = selectSpeaker({
			targetPersona: undefined,

			engagements,
			state: makeState(),
			personas
		});
		expect(result.personaId).toBe('p2');
	});

	it('スコア・沈黙・モードが全て同点の場合はランダムで選ぶ（全候補の中に収まる）', () => {
		const engagements: Engagement[] = [
			{ personaId: 'p1', score: 4, mode: 'opinion' },
			{ personaId: 'p2', score: 4, mode: 'opinion' },
			{ personaId: 'p3', score: 4, mode: 'opinion' }
		];
		const results = new Set<string>();
		// 十分な回数試行して複数候補が選ばれることを確認
		for (let i = 0; i < 50; i++) {
			const result = selectSpeaker({
				targetPersona: undefined,

				engagements,
				state: makeState(),
				personas
			});
			results.add(result.personaId);
		}
		expect(results.size).toBeGreaterThan(1);
		for (const id of results) {
			expect(['p1', 'p2', 'p3']).toContain(id);
		}
	});

	it('Math.random が 0 なら同点グループの先頭が選ばれる', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0);
		const engagements: Engagement[] = [
			{ personaId: 'p1', score: 4, mode: 'opinion' },
			{ personaId: 'p2', score: 4, mode: 'opinion' }
		];
		const result = selectSpeaker({
			targetPersona: undefined,

			engagements,
			state: makeState(),
			personas
		});
		expect(['p1', 'p2']).toContain(result.personaId);
		vi.restoreAllMocks();
	});

	it('モード同点でも沈黙が多い方が優先される（ランダムより先の基準）', () => {
		const engagements: Engagement[] = [
			{ personaId: 'p1', score: 4, mode: 'opinion' },
			{ personaId: 'p2', score: 4, mode: 'opinion' }
		];
		const silenceMap = new Map([
			['p2', 5],
			['p1', 1]
		]);
		const result = selectSpeaker({
			targetPersona: undefined,

			engagements,
			state: makeState(silenceMap),
			personas
		});
		expect(result.personaId).toBe('p2');
	});
});
