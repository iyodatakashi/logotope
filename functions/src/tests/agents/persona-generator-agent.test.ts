import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGenerateObject } = vi.hoisted(() => ({
	mockGenerateObject: vi.fn()
}));

vi.mock('ai', () => ({
	generateObject: mockGenerateObject
}));

vi.mock('../../llm/models.js', () => ({
	getPipelineModel: vi.fn(() => 'mock-model')
}));

import { generatePersonas, personasSchema } from '../../agents/persona-generator-agent.js';
import { REGIONAL_SURNAMES } from '../../constants/japanese-surnames.js';
import type { Stakeholder } from '../../types/stakeholder.types.js';

const validPersonaObject = (role: string) => ({
	sourceTag: 'S1',
	stakeholderRole: '市民',
	role,
	familyName: '',
	givenName: '太郎',
	homePrefecture: '東京都',
	nationality: '日本',
	age: 40,
	occupation: '会社員',
	background: '背景',
	interests: '関心',
	engagementLevel: 'high' as const,
	gender: 'male' as const,
	genderPresentation: 'masculine' as const
});

describe('personasSchema - 役割の非空保証', () => {
	it('role が空文字のペルソナを弾く', () => {
		const result = personasSchema(1).safeParse({ personas: [validPersonaObject('')] });
		expect(result.success).toBe(false);
	});

	it('role が非空のペルソナを受理する', () => {
		const result = personasSchema(1).safeParse({ personas: [validPersonaObject('救急医')] });
		expect(result.success).toBe(true);
	});
});

describe('generatePersonas - プロンプトの空禁止指示', () => {
	const stakeholders: Stakeholder[] = [
		{ id: 's1', role: '市民', engagementLevel: 'medium' } as Stakeholder
	];

	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateObject.mockResolvedValue({ object: { personas: [] } });
	});

	it('プロンプトに「役割を空で返さない」旨を含み、role を用いる（specificRole を残さない）', async () => {
		await generatePersonas('AIと社会', stakeholders, 'topic1');

		const content = mockGenerateObject.mock.calls[0][0].messages[0].content as string;
		expect(content).toContain('空文字で返さない');
		expect(content).toContain('- role …');
		expect(content).not.toContain('specificRole');
	});

	it('居住地を都道府県で設定させ、日本人ペルソナの姓は LLM に考えさせない', async () => {
		await generatePersonas('AIと社会', stakeholders, 'topic1');

		const content = mockGenerateObject.mock.calls[0][0].messages[0].content as string;
		expect(content).toContain('- homePrefecture …');
		expect(content).toContain('日本人ペルソナでは空文字にすること');
	});

	it('特定の姓・名を避けさせる禁止リストを持たない（偏りを別の姓へ移すだけなので廃止した）', async () => {
		await generatePersonas('AIと社会', stakeholders, 'topic1');

		const content = mockGenerateObject.mock.calls[0][0].messages[0].content as string;
		expect(content).not.toContain('超頻出姓');
		expect(content).not.toContain('佐藤');
	});
});

describe('generatePersonas - 名前の組み立て', () => {
	const stakeholders: Stakeholder[] = [
		{ id: 's1', role: '県民', engagementLevel: 'medium' } as Stakeholder
	];

	beforeEach(() => vi.clearAllMocks());

	const generateWith = async (overrides: Record<string, unknown>) => {
		mockGenerateObject.mockResolvedValue({
			object: { personas: [{ ...validPersonaObject('県民'), ...overrides }] }
		});
		const result = await generatePersonas('基地問題', stakeholders, 'topic1');
		if (!result.ok) throw new Error('generation failed');
		return result.value.personas[0];
	};

	it('日本人ペルソナには居住地に応じた姓を割り当て、LLM が返した姓は使わない', async () => {
		const persona = await generateWith({
			familyName: '郡司',
			givenName: '美和',
			homePrefecture: '沖縄県'
		});

		expect(persona.name).not.toContain('郡司');
		expect(persona.name).toMatch(/^\S+ 美和$/);
		expect(REGIONAL_SURNAMES['沖縄'].map(([surname]) => surname)).toContain(
			persona.name.split(' ')[0]
		);
		expect(persona.homePrefecture).toBe('沖縄県');
	});

	it('外国人ペルソナは LLM が返したカタカナ姓名を「名・姓」で繋ぐ', async () => {
		const persona = await generateWith({
			familyName: 'ハミルトン',
			givenName: 'ルイス',
			homePrefecture: '',
			nationality: 'イギリス'
		});

		expect(persona.name).toBe('ルイス・ハミルトン');
		expect(persona.homePrefecture).toBe('');
	});

	it('都道府県として解釈できない居住地でも、姓を返していれば外国人として扱う', async () => {
		const persona = await generateWith({
			familyName: 'シルバ',
			givenName: 'マリア',
			homePrefecture: 'サンパウロ'
		});

		expect(persona.name).toBe('マリア・シルバ');
		expect(persona.homePrefecture).toBe('');
	});

	it('「県」を落とした居住地を正式表記へ揃える', async () => {
		const persona = await generateWith({
			familyName: '',
			givenName: '美和',
			homePrefecture: '沖縄'
		});

		expect(persona.homePrefecture).toBe('沖縄県');
		expect(REGIONAL_SURNAMES['沖縄'].map(([surname]) => surname)).toContain(
			persona.name.split(' ')[0]
		);
	});

	it('居住地が読めなくても姓が空なら日本人として姓を割り当てる（姓の無い名前を作らない）', async () => {
		const persona = await generateWith({
			familyName: '',
			givenName: '健一',
			homePrefecture: '不明'
		});

		expect(persona.name).toMatch(/^\S+ 健一$/);
		expect(persona.name).not.toContain('・');
	});

	it('姓名の入力（familyName / givenName）を永続形へ持ち込まない', async () => {
		const persona = await generateWith({ givenName: '健一', homePrefecture: '東京都' });

		expect('familyName' in persona).toBe(false);
		expect('givenName' in persona).toBe(false);
	});
});
