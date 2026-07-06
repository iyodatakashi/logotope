import { generateObject } from 'ai';
import { z } from 'zod';
import { getPipelineModel } from '../llm/models.js';
import { formatFactBaseSection } from '../utils/prompt-formatters.js';
import type { Stakeholder } from '../types/stakeholder.types.js';
import type { TopicContext } from '../types/topic.types.js';
import type { Result, PipelineError } from '../types/common.types.js';

const stakeholdersSchema = z.object({
	stakeholders: z
		.array(
			z.object({
				role: z.string(),
				reason: z.string(),
				mainInterests: z.array(z.string()),
				minorityLevel: z.enum(['high', 'medium', 'low']),
				engagementLevel: z.enum(['high', 'medium', 'low'])
			})
		)
		.min(5)
});

export const generateStakeholders = async (
	title: string,
	topicContext?: TopicContext
): Promise<Result<{ stakeholders: Stakeholder[] }, PipelineError>> => {
	const factSection = formatFactBaseSection(topicContext?.factBase);
	try {
		const result = await generateObject({
			model: getPipelineModel('stakeholderAnalyzer'),
			schema: stakeholdersSchema,
			messages: [
				{
					role: 'user',
					content: `以下のテーマについて、直接・間接の全利害関係者を網羅的に分析してください。\n\nテーマ: ${title}${factSection}\n\nマイノリティや少数意見の立場も忘れずに含めてください。\n\nまた、世の中は専門家や強い当事者ばかりではありません。専門・意識レベル（engagementLevel）には必ず幅を持たせ、専門知識は乏しいが生活者目線でテーマに向き合う一般層も含めてください。ただし各レベルの人数は固定せず、そのテーマで実際に当事者がどう分布しているかに応じて自然な構成にすること（レベルごとに均等な人数にしたり、機械的に何件ずつと割り当てたりしない）。low はあくまで議論に参加する立場であり、テーマに無関心な傍観者ではありません。専門家・当事者層（high）だけに偏らせないこと。`
				}
			]
		});

		return { ok: true, value: { stakeholders: result.object.stakeholders } };
	} catch (err) {
		console.error('[generateStakeholders] error', err);
		return {
			ok: false,
			error: {
				code: 'AI_API_ERROR',
				message: err instanceof Error ? err.message : String(err),
				retryable: true
			}
		};
	}
};
