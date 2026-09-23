import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateObject = vi.hoisted(() => vi.fn());

vi.mock('ai', () => ({ generateObject: mockGenerateObject }));
vi.mock('../../llm/models.js', () => ({ getPipelineModel: vi.fn(() => 'mock-model') }));

import { generateStakeholders, stakeholdersSchema } from '../../agents/stakeholder-agent.js';
import type { TopicContext } from '../../types/topic.types.js';

const promptOf = () =>
	(mockGenerateObject.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0]
		.content;

const factContext = (statement: string): TopicContext => ({
	factBase: {
		facts: [{ statement, sources: [{ title: '報知', url: 'https://a' }] }],
		generatedAt: new Date('2026-07-03T00:00:00Z')
	}
});

const validStakeholder = (overrides: Record<string, unknown> = {}) => ({
	role: '大手AI開発企業の安全性研究部門ディレクター',
	stakeReason: '減速の主張を社内で決めている当事者',
	mainInterests: ['安全性評価'],
	stakeLevel: 'high',
	minorityLevel: 'low',
	engagementLevel: 'high',
	...overrides
});

beforeEach(() => {
	vi.clearAllMocks();
	mockGenerateObject.mockResolvedValue({ object: { stakeholders: [] } });
});

describe('generateStakeholders - 共通前提の受け取り', () => {
	it('承認済み事実基盤があればプロンプトに共通前提として反映する', async () => {
		await generateStakeholders('2026年W杯の日本を振り返る', factContext('日本は1回戦で敗退した'));
		const prompt = promptOf();
		expect(prompt).toContain('2026年W杯の日本を振り返る');
		expect(prompt).toContain('【確定した客観的事実（共通前提）】');
		expect(prompt).toContain('日本は1回戦で敗退した');
	});

	it('テーマの詳細説明を最優先の方向性としてプロンプトに載せる', async () => {
		await generateStakeholders('米国のAI企業が減速を主張し始めた', {
			description: '開発当事者自身に危機認識と社内事情を語らせたい'
		});
		const prompt = promptOf();
		expect(prompt).toContain('【テーマの方向性（最優先）】');
		expect(prompt).toContain('開発当事者自身に危機認識と社内事情を語らせたい');
	});

	it('参考資料をプロンプトに載せる', async () => {
		await generateStakeholders('テーマ', { sourceContents: ['記事Aの本文'] });
		const prompt = promptOf();
		expect(prompt).toContain('【参考資料】');
		expect(prompt).toContain('記事Aの本文');
	});

	it('詳細説明・参考資料が未設定ならタイトルと事実基盤のみで従来どおり動作する', async () => {
		await generateStakeholders('テーマ');
		const prompt = promptOf();
		expect(prompt).toContain('テーマ');
		expect(prompt).not.toContain('【テーマの方向性（最優先）】');
		expect(prompt).not.toContain('【参考資料】');
		expect(prompt).not.toContain('【確定した客観的事実（共通前提）】');
	});
});

describe('generateStakeholders - 選定基準', () => {
	it('拡散の指示（直接・間接の全利害関係者を網羅的に）を持たない', async () => {
		await generateStakeholders('テーマ');
		const prompt = promptOf();
		expect(prompt).not.toContain('全利害関係者');
		expect(prompt).not.toContain('網羅');
		expect(prompt).not.toContain('直接・間接');
	});

	it('選定基準を「問われていることへの当事者性」に置く', async () => {
		await generateStakeholders('テーマ');
		const prompt = promptOf();
		expect(prompt).toContain('問われていること');
		expect(prompt).toContain('当事者性');
	});

	it('題材領域一般にのみ当事者である立場を選ばせない', async () => {
		await generateStakeholders('テーマ');
		expect(promptOf()).toContain('題材');
	});

	it('主題となる当事者群を複数の具体的な立場へ分解させる', async () => {
		await generateStakeholders('テーマ');
		const prompt = promptOf();
		expect(prompt).toContain('分解');
		expect(prompt).toContain('単一の立場');
	});

	it('射程内の少数性・専門や意識の幅・生活者目線の一般層を引き続き求める', async () => {
		await generateStakeholders('テーマ');
		const prompt = promptOf();
		expect(prompt).toContain('少数');
		expect(prompt).toContain('生活者');
	});

	it('件数・比率を固定値で割り当てさせない', async () => {
		await generateStakeholders('テーマ');
		const prompt = promptOf();
		expect(prompt).toContain('分布');
		expect(prompt).toContain('機械的');
	});
});

describe('generateStakeholders - 3軸の独立', () => {
	it('当事者性・少数性・専門や意識の高さを独立した軸として説明する', async () => {
		await generateStakeholders('テーマ');
		const prompt = promptOf();
		expect(prompt).toContain('stakeLevel');
		expect(prompt).toContain('minorityLevel');
		expect(prompt).toContain('engagementLevel');
		expect(prompt).toContain('独立');
	});

	it('専門や意識の説明から「当事者」の語を外し、軸の混同を解く', async () => {
		await generateStakeholders('テーマ');
		const prompt = promptOf();
		const engagementLine = prompt
			.split('\n')
			.find((line) => line.includes('engagementLevel …')) as string;
		expect(engagementLine).toBeDefined();
		expect(engagementLine).not.toContain('当事者');
	});
});

describe('generateStakeholders - 所在', () => {
	it('テーマの舞台に基づいて所在を決めさせ、特定の国を既定としない', async () => {
		await generateStakeholders('テーマ');
		const prompt = promptOf();
		expect(prompt).toContain('舞台');
		expect(prompt).not.toContain('基本的には日本');
	});

	it('テーマが決めていない所在は値を持たせない', async () => {
		await generateStakeholders('テーマ');
		const prompt = promptOf();
		expect(prompt).toContain('決めていない');
		expect(prompt).toContain('推測');
	});

	it('複数の国にまたがるテーマでは立場ごとに国を選ばせる', async () => {
		await generateStakeholders('テーマ');
		expect(promptOf()).toContain('立場ごと');
	});
});

describe('stakeholdersSchema - 生成スキーマの強制', () => {
	const parse = (stakeholder: Record<string, unknown>) =>
		stakeholdersSchema.safeParse({ stakeholders: Array(5).fill(stakeholder) });

	it('理由と3軸が揃った立場を受理する', () => {
		expect(parse(validStakeholder()).success).toBe(true);
	});

	it('当事者である理由が欠けた出力を弾く', () => {
		const { stakeReason: _omitted, ...withoutReason } = validStakeholder();
		expect(parse(withoutReason).success).toBe(false);
		expect(parse(validStakeholder({ stakeReason: '' })).success).toBe(false);
	});

	it('当事者性の軸が欠けた出力を弾く', () => {
		const { stakeLevel: _omitted, ...withoutStakeLevel } = validStakeholder();
		expect(parse(withoutStakeLevel).success).toBe(false);
	});

	it('少数性・専門や意識の軸が欠けた出力を弾く', () => {
		const { minorityLevel: _m, ...withoutMinority } = validStakeholder();
		const { engagementLevel: _e, ...withoutEngagement } = validStakeholder();
		expect(parse(withoutMinority).success).toBe(false);
		expect(parse(withoutEngagement).success).toBe(false);
	});

	it('所在は国・都道府県のいずれも任意として受理する', () => {
		expect(parse(validStakeholder()).success).toBe(true);
		expect(parse(validStakeholder({ country: 'アメリカ合衆国' })).success).toBe(true);
		expect(parse(validStakeholder({ country: '日本', prefecture: '沖縄県' })).success).toBe(true);
	});

	it('都道府県は47都道府県の有限集合としてのみ受理する（表記ゆれを構造的に防ぐ）', () => {
		expect(parse(validStakeholder({ prefecture: '沖縄' })).success).toBe(false);
		expect(parse(validStakeholder({ prefecture: 'カリフォルニア州' })).success).toBe(false);
	});

	it('立場の件数に下限を持ち、上限を置かない', () => {
		const stakeholders = (count: number) =>
			stakeholdersSchema.safeParse({ stakeholders: Array(count).fill(validStakeholder()) });
		expect(stakeholders(4).success).toBe(false);
		expect(stakeholders(5).success).toBe(true);
		expect(stakeholders(30).success).toBe(true);
	});
});
