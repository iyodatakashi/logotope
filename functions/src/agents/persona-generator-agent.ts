import { generateObject } from 'ai';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getPipelineModel } from '../llm/models.js';
import { formatFactBaseSection } from '../utils/prompt-formatters.js';
import type { Stakeholder } from '../types/stakeholder.types.js';
import type { Persona } from '../types/persona.types.js';
import type { TopicContext } from '../types/topic.types.js';
import type { Result, PipelineError } from '../types/common.types.js';

const personasSchema = (count: number) =>
	z.object({
		personas: z
			.array(
				z.object({
					stakeholderRole: z.string(),
					specificRole: z.string(),
					name: z.string(),
					nationality: z.string(),
					age: z.number().int(),
					occupation: z.string(),
					background: z.string(),
					interests: z.string(),
					engagementLevel: z.enum(['high', 'medium', 'low'])
				})
			)
			.length(count)
	});

export const generatePersonas = async (
	title: string,
	stakeholders: Stakeholder[],
	topicId: string,
	topicContext?: TopicContext
): Promise<Result<{ personas: Persona[] }, PipelineError>> => {
	const engagementLabel = (level?: string) =>
		level === 'high' ? '専門・意識:高' : level === 'low' ? '専門・意識:低' : '専門・意識:中';
	const rolesDesc = stakeholders
		.map(
			(stakeholder, i) =>
				`${i + 1}. ${stakeholder.role}（${engagementLabel(stakeholder.engagementLevel)}）`
		)
		.join('\n');
	const factSection = formatFactBaseSection(topicContext?.factBase);

	try {
		const result = await generateObject({
			model: getPipelineModel('personaGenerator'),
			schema: personasSchema(stakeholders.length),
			messages: [
				{
					role: 'user',
					content: `テーマ「${title}」について、以下の各立場を代表するペルソナを1体ずつ生成してください。\n\n【命名のルール】\n- 基本的には日本人のペルソナとして生成すること。ただしテーマが明らかに海外を舞台とする（例: F1、海外スポーツ、国際政治）場合は、そのテーマに合った国籍の人物を含めること\n- 佐藤・田中・鈴木など超頻出姓、陽菜・蓮・葵など近年多用される名前への偏りを避けること\n- 日本人名は地域性（東北・関西・九州など）や年代感（昭和・平成・令和の命名傾向の違い）をペルソナの年齢・背景に合わせて反映させること\n- 外国人ペルソナを含める場合はその国籍の実際の名前の傾向を反映させ、表記はカタカナにすること（例: ルイス・ハミルトン、カルロス・サインツ）\n- 年齢層・職業・社会的背景の多様性を確保すること\n\n立場リスト:\n${rolesDesc}${factSection}\n\n各ペルソナは「実在する一人の人物」として設定してください。職業は具体的な職種・役職まで落とし込み、背景には家族構成・居住地・年収・趣味など生活の具体的なディテールを盛り込んでください。\n\n【立場の具体化（重要）】\n各ペルソナには3つの属性がある。混同しないこと。\n- stakeholderRole … 対応するステークホルダーの総称。立場リストの総称をそのまま引き継ぐ（例: F1チーム関係者）。\n- specificRole … このテーマにおける「具体的な立場・肩書き」。「F1チーム関係者」のような総称は、オーナー／レースエンジニア／メカニックなど具体的な役職に必ず特定する。「F1の熱心なファン」のように総称が既に具体的なら、それを反映する。\n- occupation … 実生活上の職業。テーマに職業として関わる人物では specificRole と一致するが、「F1の熱心なファン」のように職業外で関わる人物では、occupation がテーマと無関係（例: 市役所職員）でよい。その場合でもその人物のテーマ上の立場（specificRole）は「F1の熱心なファン」である。職業を立場と取り違えないこと。\n\n【専門・意識レベルに応じた描き分け（重要）】\n人物の「テーマに対する専門知識・意識の高さ」を、立場リストの専門・意識レベルに必ず合わせてください。全員を持論の強い専門家・当事者にしないこと。ただし、どのレベルの人物も議論には主体的に参加し、自分なりの意見を持っています。無関心・他人事の傍観者は作らないでください。\n- 専門・意識:高 → テーマを深く考え、明確な持論・専門的な視点を持つ人物として描く\n- 専門・意識:中 → 専門家ではないが一定の知識と関心を持ち、生活実感に基づく等身大の意見を持つ人物として描く\n- 専門・意識:低 → 専門知識は乏しく難しい用語は使わない人物。生活者・当事者の目線から、生活実感に根ざした素朴な意見・疑問・要望を自分なりに持つ。interests は専門用語を避け、この人物の生活に根ざした具体的な関心事として記述すること\n\nengagementLevel には、対応するステークホルダーの専門・意識レベルをそのまま設定してください。`
				}
			]
		});

		type LLMPersona = Omit<Persona, 'id' | 'topicId' | 'approved' | 'sortOrder'>;
		const personas: Persona[] = result.object.personas.map((persona, i) => ({
			...(persona as LLMPersona),
			id: nanoid(),
			topicId,
			approved: false,
			sortOrder: i
		}));
		return { ok: true, value: { personas } };
	} catch (err) {
		console.error('[generatePersonas] error', err);
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
