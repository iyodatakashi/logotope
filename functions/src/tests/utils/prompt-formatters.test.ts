import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	formatTurns,
	formatFactBaseSection,
	formatAwarenessSection,
	formatJapaneseDate,
	currentDateString
} from '../../utils/prompt-formatters.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Persona, AwarenessForFirestore } from '../../types/persona.types.js';
import type { FactBase } from '../../types/topic.types.js';

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

describe('formatFactBaseSection', () => {
	const factBase = (facts: FactBase['facts']): FactBase => ({
		facts,
		generatedAt: new Date('2026-07-03T00:00:00Z')
	});

	it('factBase 未指定なら空文字を返す', () => {
		expect(formatFactBaseSection(undefined)).toBe('');
	});

	it('facts が空なら空文字を返す（従来どおり動作）', () => {
		expect(formatFactBaseSection(factBase([]))).toBe('');
	});

	it('事実を「確定した客観的事実（共通前提）」節として整形し、参考資料と区別する', () => {
		const section = formatFactBaseSection(
			factBase([
				{ statement: '日本は1回戦で敗退した', sources: [{ title: '報知', url: 'https://a' }] }
			])
		);
		expect(section).toContain('【確定した客観的事実（共通前提）】');
		expect(section).toContain('日本は1回戦で敗退した');
		expect(section).toContain('参考資料とは別に');
		expect(section).toContain('報知');
	});

	it('出典が無い事実は出典表記なしで列挙する', () => {
		const section = formatFactBaseSection(factBase([{ statement: '事実のみ', sources: [] }]));
		expect(section).toContain('事実のみ');
		expect(section).not.toContain('出典:');
	});
});

describe('formatJapaneseDate / currentDateString（dayjs 置換の出力同一・AC4.5）', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('「YYYY年M月D日」形式で整形し、月・日に先頭ゼロを付けない（旧手書き実装と同一）', () => {
		expect(formatJapaneseDate(new Date(2026, 6, 6))).toBe('2026年7月6日');
		expect(formatJapaneseDate(new Date(2026, 0, 5))).toBe('2026年1月5日');
		expect(formatJapaneseDate(new Date(2026, 11, 31))).toBe('2026年12月31日');
	});

	it('currentDateString は実行時点の日付を同形式で返す', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 6, 6, 10, 30));
		expect(currentDateString()).toBe('2026年7月6日');
	});
});

describe('formatAwarenessSection', () => {
	const awareness = (
		over: Partial<AwarenessForFirestore> & Pick<AwarenessForFirestore, 'kind' | 'content'>
	): AwarenessForFirestore => ({
		id: 'a1',
		sourcePersonaId: null,
		triggeredByTurnId: 't1',
		createdAt: 'TS' as never,
		...over
	});

	it('未指定・空なら空文字を返す', () => {
		expect(formatAwarenessSection(undefined)).toBe('');
		expect(formatAwarenessSection([])).toBe('');
	});

	it('reception と self を区別して「討論中に得た気づき」節に整形する', () => {
		const section = formatAwarenessSection([
			awareness({ kind: 'reception', content: '規制側にも一理ある', sourcePersonaId: 'p2' }),
			awareness({ kind: 'self', content: '自分の経験から気づいた' })
		]);
		expect(section).toContain('【討論中に得た気づき】');
		expect(section).toContain('規制側にも一理ある');
		expect(section).toContain('自分の経験から気づいた');
		expect(section).toContain('受容');
		expect(section).toContain('自分の気づき');
		// 信念（主軸）は変えず立場を反転させない旨を添える
		expect(section).toContain('信念');
	});
});
