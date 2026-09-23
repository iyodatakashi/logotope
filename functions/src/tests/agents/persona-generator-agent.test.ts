import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const stakeholder = (overrides: Partial<Stakeholder> = {}): Stakeholder => ({
	id: 's1',
	role: '市民',
	stakeReason: '日々の暮らしで直接影響を受けている',
	mainInterests: ['生活費'],
	stakeLevel: 'medium',
	minorityLevel: 'low',
	engagementLevel: 'medium',
	...overrides
});

const validPersonaObject = (role: string) => ({
	sourceTag: 'S1',
	stakeholderRole: '市民',
	role,
	familyName: '',
	givenName: '太郎',
	prefecture: '東京都',
	country: '日本',
	age: 40,
	occupation: '会社員',
	background: '背景',
	interests: '関心',
	engagementLevel: 'high' as const,
	gender: 'male' as const,
	genderPresentation: 'masculine' as const
});

const promptOf = () => mockGenerateObject.mock.calls[0][0].messages[0].content as string;

describe('personasSchema - 生成スキーマ', () => {
	it('role が空文字のペルソナを弾く', () => {
		expect(personasSchema(1).safeParse({ personas: [validPersonaObject('')] }).success).toBe(false);
	});

	it('role が非空のペルソナを受理する', () => {
		expect(personasSchema(1).safeParse({ personas: [validPersonaObject('救急医')] }).success).toBe(
			true
		);
	});

	it('所在を持たないペルソナを受理する（国・都道府県はいずれも任意）', () => {
		const { prefecture: _p, country: _c, ...withoutLocation } = validPersonaObject('救急医');
		expect(personasSchema(1).safeParse({ personas: [withoutLocation] }).success).toBe(true);
	});

	it('都道府県は47都道府県の有限集合としてのみ受理する（正規化を経路から外す）', () => {
		const loose = { ...validPersonaObject('救急医'), prefecture: '沖縄' };
		expect(personasSchema(1).safeParse({ personas: [loose] }).success).toBe(false);
	});
});

describe('generatePersonas - プロンプト', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGenerateObject.mockResolvedValue({ object: { personas: [] } });
	});

	it('特定国籍を既定とする記述を持たない', async () => {
		await generatePersonas('AIと社会', [stakeholder()], 'topic1');
		const prompt = promptOf();
		expect(prompt).not.toContain('基本的には日本人');
		expect(prompt).not.toContain('外国人ペルソナ');
		expect(prompt).not.toContain('例外');
	});

	it('テーマの詳細説明・参考資料を共通前提として載せる', async () => {
		await generatePersonas('AIと社会', [stakeholder()], 'topic1', {
			description: '開発当事者自身に語らせたい',
			sourceContents: ['記事Aの本文']
		});
		const prompt = promptOf();
		expect(prompt).toContain('【テーマの方向性（最優先）】');
		expect(prompt).toContain('開発当事者自身に語らせたい');
		expect(prompt).toContain('【参考資料】');
		expect(prompt).toContain('記事Aの本文');
	});

	it('立場の全項目を渡す（死蔵を残さない）', async () => {
		await generatePersonas(
			'AIと社会',
			[
				stakeholder({
					role: 'AI開発企業の安全性研究ディレクター',
					stakeReason: '減速の主張を社内で決めている',
					mainInterests: ['安全性評価', '公開の可否'],
					country: 'アメリカ合衆国',
					stakeLevel: 'high',
					minorityLevel: 'low',
					engagementLevel: 'high'
				})
			],
			'topic1'
		);
		const prompt = promptOf();
		expect(prompt).toContain('AI開発企業の安全性研究ディレクター');
		expect(prompt).toContain('減速の主張を社内で決めている');
		expect(prompt).toContain('安全性評価');
		expect(prompt).toContain('公開の可否');
		expect(prompt).toContain('アメリカ合衆国');
		expect(prompt).toContain('当事者性:高');
		expect(prompt).toContain('少数性:低');
		expect(prompt).toContain('専門・意識:高');
	});

	it('立場が決めた所在を変えない旨を指示する', async () => {
		await generatePersonas('AIと社会', [stakeholder({ country: 'アメリカ合衆国' })], 'topic1');
		const prompt = promptOf();
		expect(prompt).toContain('変えない');
		expect(prompt).toContain('翻案');
	});

	it('立場が土地を決めていない人物に土地を推測で埋めさせない', async () => {
		await generatePersonas('AIと社会', [stakeholder()], 'topic1');
		expect(promptOf()).toContain('推測');
	});

	it('日本語の姓名の人物は姓を空で返させる（姓の割り当てを LLM に戻さない）', async () => {
		await generatePersonas('AIと社会', [stakeholder()], 'topic1');
		const prompt = promptOf();
		expect(prompt).toContain('familyName');
		expect(prompt).toContain('空文字');
	});

	it('出自として自然な氏名・表記の一貫性・出自によらない生活の具体性を求める', async () => {
		await generatePersonas('AIと社会', [stakeholder()], 'topic1');
		const prompt = promptOf();
		expect(prompt).toContain('出自');
		expect(prompt).toContain('一貫');
		expect(prompt).toContain('同等');
	});

	it('既存の生成品質要求（立場の具体化・描き分け・性の2軸・架空の一人）を保持する', async () => {
		await generatePersonas('AIと社会', [stakeholder()], 'topic1');
		const prompt = promptOf();
		expect(prompt).toContain('空文字で返さない');
		expect(prompt).toContain('- role …');
		expect(prompt).not.toContain('specificRole');
		expect(prompt).toContain('専門・意識レベルに応じた描き分け');
		expect(prompt).toContain('genderPresentation');
		expect(prompt).toContain('架空');
	});
});

describe('generatePersonas - 所在の引き継ぎ（コードが確定させる）', () => {
	beforeEach(() => vi.clearAllMocks());

	const generateWith = async (
		personaOverrides: Record<string, unknown>,
		stakeholders: Stakeholder[] = [stakeholder()]
	) => {
		mockGenerateObject.mockResolvedValue({
			object: { personas: [{ ...validPersonaObject('県民'), ...personaOverrides }] }
		});
		const result = await generatePersonas('基地問題', stakeholders, 'topic1');
		if (!result.ok) throw new Error('generation failed');
		return result.value.personas[0];
	};

	it('立場が国を決めていれば、生成結果が別の国を返しても立場の値を採る', async () => {
		const persona = await generateWith({ country: '日本', prefecture: '東京都' }, [
			stakeholder({ country: 'アメリカ合衆国' })
		]);

		expect(persona.country).toBe('アメリカ合衆国');
	});

	it('立場が都道府県を決めていれば、生成結果が別の県を返しても立場の値を採る', async () => {
		const persona = await generateWith({ prefecture: '東京都' }, [
			stakeholder({ country: '日本', prefecture: '沖縄県' })
		]);

		expect(persona.prefecture).toBe('沖縄県');
	});

	it('立場が空にした項目は生成結果の値を採る', async () => {
		const persona = await generateWith({ country: '日本', prefecture: '沖縄県' }, [stakeholder()]);

		expect(persona.country).toBe('日本');
		expect(persona.prefecture).toBe('沖縄県');
	});

	it('立場もペルソナも所在を持たなければ、所在を持たないまま成立する', async () => {
		const { country: _c, prefecture: _p, ...withoutLocation } = validPersonaObject('県民');
		mockGenerateObject.mockResolvedValue({
			object: { personas: [{ ...withoutLocation, familyName: 'シルバ', givenName: 'マリア' }] }
		});
		const result = await generatePersonas('基地問題', [stakeholder()], 'topic1');
		if (!result.ok) throw new Error('generation failed');

		// 「未設定」は undefined を値に置くことではなくキーの不在で表す。
		// Firestore は undefined を値として受け付けず、1体でも混じると batch 全体が弾かれる。
		expect('country' in result.value.personas[0]).toBe(false);
		expect('prefecture' in result.value.personas[0]).toBe(false);
	});

	it('立場が国だけを決めた人物は、都道府県のキーを持たない', async () => {
		const { prefecture: _p, ...withoutPrefecture } = validPersonaObject('研究者');
		mockGenerateObject.mockResolvedValue({
			object: {
				personas: [{ ...withoutPrefecture, familyName: 'チェン', givenName: 'サラ' }]
			}
		});
		const result = await generatePersonas(
			'AIと社会',
			[stakeholder({ country: 'アメリカ合衆国' })],
			'topic1'
		);
		if (!result.ok) throw new Error('generation failed');

		expect(result.value.personas[0].country).toBe('アメリカ合衆国');
		expect('prefecture' in result.value.personas[0]).toBe(false);
	});

	it('由来の突合はエコー用タグで行い、出力順に依存しない', async () => {
		mockGenerateObject.mockResolvedValue({
			object: {
				personas: [
					{ ...validPersonaObject('県民'), sourceTag: 'S2', country: '日本' },
					{ ...validPersonaObject('市民'), sourceTag: 'S1', country: '日本' }
				]
			}
		});
		const result = await generatePersonas(
			'基地問題',
			[stakeholder({ id: 's1' }), stakeholder({ id: 's2', country: 'アメリカ合衆国' })],
			'topic1'
		);
		if (!result.ok) throw new Error('generation failed');

		expect(result.value.personas[0].country).toBe('アメリカ合衆国');
		expect(result.value.personas[1].country).toBe('日本');
	});
});

describe('generatePersonas - 名前の組み立て', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => vi.restoreAllMocks());

	const generateWith = async (
		overrides: Record<string, unknown>,
		stakeholders: Stakeholder[] = [stakeholder()]
	) => {
		mockGenerateObject.mockResolvedValue({
			object: { personas: [{ ...validPersonaObject('県民'), ...overrides }] }
		});
		const result = await generatePersonas('基地問題', stakeholders, 'topic1');
		if (!result.ok) throw new Error('generation failed');
		return result.value.personas[0];
	};

	it('日本語の姓名の人物（姓が空）には都道府県に応じた地域の姓を割り当てる', async () => {
		// 地域姓を引く分岐を決定的に通す（REGIONAL_RATIO 未満を満たす）
		vi.spyOn(Math, 'random').mockReturnValue(0);
		const persona = await generateWith({
			familyName: '',
			givenName: '美和',
			prefecture: '沖縄県'
		});

		expect(persona.name).toMatch(/^\S+ 美和$/);
		expect(REGIONAL_SURNAMES['沖縄'].map(([surname]) => surname)).toContain(
			persona.name.split(' ')[0]
		);
		expect(persona.prefecture).toBe('沖縄県');
	});

	it('姓を返した人物の姓は日本国内に暮らしていても差し替えない（出自として自然な氏名を保つ）', async () => {
		const persona = await generateWith({
			familyName: 'グエン',
			givenName: 'ミン',
			country: '日本',
			prefecture: '愛知県'
		});

		expect(persona.name).toBe('ミン・グエン');
		expect(persona.prefecture).toBe('愛知県');
	});

	it('日本語以外の姓名は LLM が返した姓名を「名・姓」で繋ぐ', async () => {
		const persona = await generateWith({
			familyName: 'ハミルトン',
			givenName: 'ルイス',
			country: 'イギリス',
			prefecture: undefined
		});

		expect(persona.name).toBe('ルイス・ハミルトン');
		expect(persona.country).toBe('イギリス');
	});

	it('都道府県を持たない日本語の姓名の人物にも全国の語彙から姓を割り当てる', async () => {
		const persona = await generateWith({
			familyName: '',
			givenName: '健一',
			prefecture: undefined,
			country: '日本'
		});

		expect(persona.name).toMatch(/^\S+ 健一$/);
		expect(persona.name).not.toContain('・');
	});

	it('姓名の入力（familyName / givenName）を永続形へ持ち込まない', async () => {
		const persona = await generateWith({ givenName: '健一' });

		expect('familyName' in persona).toBe(false);
		expect('givenName' in persona).toBe(false);
	});
});
