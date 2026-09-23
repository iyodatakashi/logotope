import { generateObject } from 'ai';
import { z } from 'zod';
import { getPipelineModel } from '../llm/models.js';
import { formatTopicContextSection } from '../utils/prompt-formatters.js';
import { PREFECTURES } from '../constants/surname-regions.js';
import type { Stakeholder } from '../types/stakeholder.types.js';
import type { TopicContext } from '../types/topic.types.js';
import type { Result, PipelineError } from '../types/common.types.js';
import { llmTask } from '../llm/usage-recorder.js';

// 理由と3軸は必須。所在は任意（テーマが決めている範囲だけ値を持つ）。
// 都道府県は有限集合として受け取るため、表記ゆれを吸収する正規化が要らない。
// 下限のみ置き、上限は置かない（件数はその問いの当事者の分布で決まる）。
export const stakeholdersSchema = z.object({
	stakeholders: z
		.array(
			z.object({
				role: z.string().min(1),
				stakeReason: z.string().min(1),
				mainInterests: z.array(z.string()),
				country: z.string().optional(),
				prefecture: z.enum(PREFECTURES).optional(),
				stakeLevel: z.enum(['high', 'medium', 'low']),
				minorityLevel: z.enum(['high', 'medium', 'low']),
				engagementLevel: z.enum(['high', 'medium', 'low'])
			})
		)
		.min(5)
});

const SELECTION_CRITERION = `【立場の選び方】
このテーマで「何が問われているか」をまず読み取り、その問いに対する当事者性で立場を選んでください。題材領域の一般的な利害関係者を並べる作業ではありません。

- 当事者性は問いに対する相対値です。同じ題材でも問いが変われば当事者は入れ替わります（「満員電車へのベビーカー持ち込みは許されるか」なら親と一般利用者、「鉄道事業者はなぜ明確なルールを出さないのか」なら事業者と運輸行政）。
- 題材領域一般に対してのみ当事者であり、問われていることに対して当事者でない立場は選ばないでください。その領域の解説者・監督者・論評者は、問いの当事者でない限り場に呼びません。
- テーマが特定の当事者群を主題としているとき、その当事者群を単一の立場に畳まないでください。内部で利害・判断・見えている景色が異なる複数の具体的な立場へ分解します（例: 同じ企業の中でも、意思決定をする経営層／その判断で仕事が変わる現場／外向けに説明する役回りは別の立場です）。
- 各立場について、問われていることに対してどう当事者であるかを stakeReason に書いてください。`;

const DIVERSITY_REQUIREMENT = `【射程を絞ったうえでの幅】
問いの射程を絞ることと、その射程内で幅を持たせることは両立します。射程内で次を満たしてください。
- 声が届きにくい少数の立場を落とさないこと
- 専門知識・意識の高さに幅を持たせること。専門家だけで埋めないこと
- 専門知識は乏しいが、生活者の目線でこの問いに向き合う一般層を含めること
立場の件数や各レベルの人数を固定値で機械的に割り当てないでください。その問いに当事者がどう分布しているかに応じた構成にします。`;

const AXES = `【3つの軸（互いに独立。一方から他方を導かない）】
- stakeLevel … 当事者性。問われていることが、その立場の生活・利害・職務にどれだけ直接刺さるか。
- minorityLevel … 少数性。その立場の声が社会でどれだけ届きにくいか。
- engagementLevel … 専門知識・意識の高さ。テーマについてどれだけ知り、どれだけ考えているか。high は専門的な視点と明確な持論を持つ、medium は一定の知識と関心を持つ、low は専門知識に乏しく生活実感に根ざした素朴な意見を持つ。low も議論には主体的に参加します（無関心な傍観者ではありません）。
当事者性が高い立場が少数派とは限らず、専門知識を持つとも限りません。3軸はそれぞれ別に判断してください。`;

const LOCATION = `【所在】
- テーマの舞台（その出来事・制度・組織が属する国や地域）に基づいて各立場の所在を決めてください。特定の国を既定にせず、他を例外扱いしないこと。
- country … その立場が属する国。テーマが国を決めているときだけ設定します。
- prefecture … 日本国内で、土地がその立場の本質であるときだけ設定します（例: 基地が集中する地域の住民、被災地の生業）。47都道府県の正式表記から選びます。
- テーマが決めていない所在は設定しないでください。値を持たないことは正しい状態です。所在を埋めるために推測しないこと。
- テーマが複数の国にまたがるときは、立場ごとにその立場が実際に存在する国を選び、キャストを単一の国へ統一しないでください。`;

// 生成物は id を持たない（id はサーバが永続時に付番する）。
export const generateStakeholders = llmTask(
	'stakeholders',
	async (
		title: string,
		topicContext?: TopicContext
	): Promise<Result<{ stakeholders: Omit<Stakeholder, 'id'>[] }, PipelineError>> => {
		const contextSection = formatTopicContextSection(topicContext);
		try {
			const result = await generateObject({
				model: getPipelineModel('stakeholderAnalyzer'),
				schema: stakeholdersSchema,
				messages: [
					{
						role: 'user',
						content: `以下のテーマの討論に呼ぶ立場を選んでください。\n\nテーマ: ${title}${contextSection}\n\n${SELECTION_CRITERION}\n\n${DIVERSITY_REQUIREMENT}\n\n${AXES}\n\n${LOCATION}`
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
	}
);
