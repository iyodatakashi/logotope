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
import type { Stakeholder } from '../../types/stakeholder.types.js';

const validPersonaObject = (role: string) => ({
	sourceTag: 'S1',
	stakeholderRole: '市民',
	role,
	name: '田中 太郎',
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
});
