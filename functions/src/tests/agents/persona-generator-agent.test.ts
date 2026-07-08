import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateObject = vi.hoisted(() => vi.fn());

vi.mock('ai', () => ({ generateObject: mockGenerateObject }));
vi.mock('../../llm/models.js', () => ({ getPipelineModel: vi.fn(() => 'mock-model') }));

import { generatePersonas } from '../../agents/persona-generator-agent.js';
import type { Stakeholder } from '../../types/stakeholder.types.js';
import type { TopicContext } from '../../types/topic.types.js';

const STAKEHOLDERS: Stakeholder[] = [
	{ role: '医師', reason: 'r', mainInterests: [], minorityLevel: 'low', engagementLevel: 'high' }
];

const promptOf = () =>
	(mockGenerateObject.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0]
		.content;

const factContext = (statement: string): TopicContext => ({
	factBase: {
		facts: [{ statement, sources: [] }],
		generatedAt: new Date('2026-07-03T00:00:00Z')
	}
});

beforeEach(() => {
	vi.clearAllMocks();
	mockGenerateObject.mockResolvedValue({ object: { personas: [] } });
});

describe('generatePersonas', () => {
	it('承認済み事実基盤があればプロンプトに共通前提として反映する', async () => {
		await generatePersonas('テーマ', STAKEHOLDERS, 't1', factContext('確定事実X'));
		const prompt = promptOf();
		expect(prompt).toContain('【確定した客観的事実（共通前提）】');
		expect(prompt).toContain('確定事実X');
	});

	it('事実基盤が空のときはテーマ・ステークホルダー情報のみで従来どおり動作する', async () => {
		await generatePersonas('テーマ', STAKEHOLDERS, 't1', {
			factBase: { facts: [], generatedAt: new Date() }
		});
		expect(promptOf()).not.toContain('【確定した客観的事実（共通前提）】');
	});

	it('topicContext 未指定でも従来どおり動作する', async () => {
		await generatePersonas('テーマ', STAKEHOLDERS, 't1');
		expect(promptOf()).not.toContain('【確定した客観的事実（共通前提）】');
	});

	it('生成スキーマに llmType を含めない（Req 2.3）', async () => {
		await generatePersonas('テーマ', STAKEHOLDERS, 't1');
		const { schema } = mockGenerateObject.mock.calls[0][0] as {
			schema: { shape: { personas: { element: { shape: Record<string, unknown> } } } };
		};
		expect('llmType' in schema.shape.personas.element.shape).toBe(false);
	});
});
