import { describe, it, expect } from 'vitest';
import { formatTurns } from '../../utils/prompt-formatters.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Persona } from '../../types/persona.types.js';

const makePersona = (
	id: string,
	name: string,
	specificRole: string,
	stakeholderRole = ''
): Persona => ({
	id,
	topicId: 'topic1',
	name,
	age: 35,
	occupation: '会社員',
	stakeholderRole,
	specificRole,
	background: '背景',
	interests: '関心',
	nationality: '日本',
	engagementLevel: 'moderate',
	llmType: 'claude',
	approved: true,
	sortOrder: 0
});

const makeFacilitatorTurn = (content: string): DebateTurn => ({
	id: 't1',
	speakerType: 'facilitator',
	content,
	createdAt: ''
});

const makePersonaTurn = (personaId: string, content: string): DebateTurn => ({
	id: 't2',
	speakerType: 'persona',
	personaId,
	content,
	createdAt: ''
});

describe('formatTurns', () => {
	it('空配列を渡すと空文字列を返す', () => {
		expect(formatTurns([], [])).toBe('');
	});

	it('ファシリテーターターンを [ファシリテーター()]: content 形式に変換する', () => {
		const turns = [makeFacilitatorTurn('討論を始めます。')];
		expect(formatTurns(turns, [])).toBe('[ファシリテーター()]: 討論を始めます。');
	});

	it('ペルソナターンを personas から解決して [名前(役割)(ID:id)]: content 形式に変換する', () => {
		const turns = [makePersonaTurn('p1', '賛成です。')];
		const personas = [makePersona('p1', '田中太郎', '医師')];
		expect(formatTurns(turns, personas)).toBe('[田中太郎(医師)(ID:p1)]: 賛成です。');
	});

	it('specificRole が空の場合は stakeholderRole を使用する', () => {
		const turns = [makePersonaTurn('p1', '発言内容')];
		const personas = [makePersona('p1', '田中', '', '市民')];
		expect(formatTurns(turns, personas)).toBe('[田中(市民)(ID:p1)]: 発言内容');
	});

	it('personaId が personas に存在しない場合は Persona(id) にフォールバックする', () => {
		const turns = [makePersonaTurn('p99', 'テスト発言')];
		expect(formatTurns(turns, [])).toBe('[Persona(p99)()(ID:p99)]: テスト発言');
	});

	it('personas が空配列でもエラーが発生しない', () => {
		const turns = [makeFacilitatorTurn('テスト'), makePersonaTurn('p1', 'テスト')];
		expect(() => formatTurns(turns, [])).not.toThrow();
	});

	it('複数のターンを改行で結合する', () => {
		const personas = [makePersona('p1', '田中太郎', '医師')];
		const turns = [makeFacilitatorTurn('開会します。'), makePersonaTurn('p1', '賛成です。')];
		expect(formatTurns(turns, personas)).toBe(
			'[ファシリテーター()]: 開会します。\n[田中太郎(医師)(ID:p1)]: 賛成です。'
		);
	});
});
