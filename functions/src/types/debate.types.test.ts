import { describe, it, expect } from 'vitest';
import type { Engagement, PersonaReply, DebateTurn, TurnGenerationContext } from './debate.types.js';

describe('debate.types - questionモード型定義', () => {
	it('Engagement.mode に question が含まれる', () => {
		const engagement: Engagement = {
			personaId: 'p1',
			score: 4,
			mode: 'question',
			intentSummary: '○○さんの意見の根拠を確認したい',
		};
		expect(engagement.mode).toBe('question');
	});

	it('PersonaReply.speechMode に question が含まれる', () => {
		const reply: PersonaReply = {
			content: 'テスト発言',
			speechMode: 'question',
			beliefChange: null,
			targetPersonaId: 'p2',
		};
		expect(reply.speechMode).toBe('question');
	});

	it('DebateTurn.speechMode に question が含まれる', () => {
		const turn: DebateTurn = {
			id: 'turn1',
			turnIndex: 0,
			speakerType: 'persona',
			content: 'テスト発言',
			createdAt: '2026-01-01T00:00:00Z',
			speechMode: 'question',
		};
		expect(turn.speechMode).toBe('question');
	});

	it('TurnGenerationContext に otherPersonas フィールドが含まれる', () => {
		const context: TurnGenerationContext = {
			chapterTurns: [],
			chapter: { id: 'ch1', title: 'テスト', focusQuestion: 'テスト？' },
			otherPersonas: [{ id: 'p2', name: 'ペルソナB' }],
		};
		expect(context.otherPersonas).toHaveLength(1);
		expect(context.otherPersonas[0].id).toBe('p2');
	});

	it('TurnGenerationContext.otherPersonas は空配列も受け入れる', () => {
		const context: TurnGenerationContext = {
			chapterTurns: [],
			chapter: { id: 'ch1', title: 'テスト', focusQuestion: 'テスト？' },
			otherPersonas: [],
		};
		expect(context.otherPersonas).toHaveLength(0);
	});
});
