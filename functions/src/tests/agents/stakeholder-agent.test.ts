import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateObject = vi.hoisted(() => vi.fn());

vi.mock('ai', () => ({ generateObject: mockGenerateObject }));
vi.mock('../../llm/models.js', () => ({ getPipelineModel: vi.fn(() => 'mock-model') }));

import { generateStakeholders } from '../../agents/stakeholder-agent.js';
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

beforeEach(() => {
	vi.clearAllMocks();
	mockGenerateObject.mockResolvedValue({ object: { stakeholders: [] } });
});

describe('generateStakeholders', () => {
	it('承認済み事実基盤があればプロンプトに共通前提として反映する', async () => {
		await generateStakeholders('2026年W杯の日本を振り返る', factContext('日本は1回戦で敗退した'));
		const prompt = promptOf();
		expect(prompt).toContain('2026年W杯の日本を振り返る');
		expect(prompt).toContain('【確定した客観的事実（共通前提）】');
		expect(prompt).toContain('日本は1回戦で敗退した');
	});

	it('事実基盤が空のときはテーマ情報のみで従来どおり動作する（事実節なし）', async () => {
		await generateStakeholders('テーマ', { factBase: { facts: [], generatedAt: new Date() } });
		expect(promptOf()).not.toContain('【確定した客観的事実（共通前提）】');
	});

	it('topicContext 未指定でも従来どおり動作する', async () => {
		await generateStakeholders('テーマ');
		expect(promptOf()).not.toContain('【確定した客観的事実（共通前提）】');
	});
});
