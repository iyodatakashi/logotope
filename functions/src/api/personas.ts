import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { generateText, jsonSchema } from 'ai';
import { getPipelineModel } from '../llm/models.js';
import { requireAuth } from '../utils/auth.js';
import { MAX_TOKENS } from '../constants/ai.constants.js';
import type { Stakeholder } from '../types/index.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

const buildPersonaTools = (count: number) =>
	({
		submit_personas: {
			description: 'ステークホルダーリストの各立場に対応するペルソナを1体ずつ生成して提出する',
			parameters: jsonSchema({
				type: 'object' as const,
				additionalProperties: false as const,
				properties: {
					personas: {
						type: 'array' as const,
						minItems: count,
						maxItems: count,
						items: {
							type: 'object' as const,
							additionalProperties: false as const,
							properties: {
								stakeholderRole: {
									type: 'string' as const,
									description:
										'どのステークホルダー（立場の総称）に対応するか。立場リストの総称をそのまま記入する（例: F1チーム関係者）'
								},
								specificRole: {
									type: 'string' as const,
									description:
										'このテーマにおけるその人物の具体的な立場・肩書き。stakeholderRole が「F1チーム関係者」のような総称の場合は、オーナー／レースエンジニア／メカニックなど具体的な役職に必ず特定する。「F1の熱心なファン」のように総称が既に具体的ならそれを反映する。occupation（実生活上の職業）とは別物で、ファンなど職業外で関わる人物では両者は異なる'
								},
								name: {
									type: 'string' as const,
									description:
										'氏名（テーマ・ステークホルダーの国際的文脈に合った名前。グローバルなテーマでは多国籍の名前を使う）'
								},
								nationality: { type: 'string' as const, description: '国籍・出身国' },
								age: { type: 'integer' as const, description: '年齢' },
								occupation: {
									type: 'string' as const,
									description:
										'実生活上の職業（具体的な職種・役職を1つ。例: 中学校の理科教師、物流会社の経理担当）。テーマに職業として関わる人物では specificRole と一致するが、ファンや利用者などテーマへの関わりが職業由来でない人物では、テーマと無関係な職業（例: 市役所職員）でよい。カテゴリ名や職種の列挙は禁止'
								},
								background: {
									type: 'string' as const,
									description:
										'人物像を具体的に描写（200字以内）。家族構成・居住地・年収・趣味・生活習慣など、この人物をリアルに想像できる情報を盛り込む。例：「妻と小学生の子ども2人の4人家族。埼玉県の一戸建てに住む。年収600万円台。週末はサッカーコーチとして地域の少年団に関わる。」'
								},
								interests: {
									type: 'string' as const,
									description:
										'テーマに対して持つ具体的な関心事・懸念・期待（200字以内）。抽象的な価値観ではなく、この人物の生活・立場から生まれる具体的な視点を記述する'
								},
								engagementLevel: {
									type: 'string' as const,
									enum: ['high', 'medium', 'low'],
									description:
										'対応するステークホルダーの専門・意識レベルをそのまま引き継ぐ。high=専門知識を持ち明確な持論がある当事者・専門家、medium=一定の知識と関心を持つ等身大の市民、low=専門知識は乏しいが生活者目線で自分なりの意見を持つ一般層'
								},
								llmType: {
									type: 'string' as const,
									enum: ['gemini', 'claude', 'gpt'],
									description:
										'gemini=最新情報重視・SNS世論に敏感(記者・アナリスト・活動家等)、claude=学術・論理重視(研究者・教授等)、gpt=バランス型(一般市民・会社員等)'
								}
							},
							required: [
								'stakeholderRole',
								'specificRole',
								'name',
								'nationality',
								'age',
								'occupation',
								'background',
								'interests',
								'engagementLevel',
								'llmType'
							]
						}
					}
				},
				required: ['personas']
			})
		}
	}) as const;

export const generatePersonas = onCall(
	{ timeoutSeconds: 300, secrets: SECRETS },
	async (request) => {
		requireAuth(request);
		const { title, stakeholders } = request.data as { title: string; stakeholders: Stakeholder[] };
		if (!title?.trim()) throw new HttpsError('invalid-argument', 'title is required');
		if (!stakeholders?.length) throw new HttpsError('invalid-argument', 'stakeholders is required');

		const engagementLabel = (level?: string) =>
			level === 'high' ? '専門・意識:高' : level === 'low' ? '専門・意識:低' : '専門・意識:中';
		const rolesDesc = stakeholders
			.map((s, i) => `${i + 1}. ${s.role}（${engagementLabel(s.engagementLevel)}）`)
			.join('\n');

		let result;
		try {
			result = await generateText({
				model: getPipelineModel('personaGenerator'),
				maxTokens: MAX_TOKENS.PERSONA,
				tools: buildPersonaTools(stakeholders.length),
				toolChoice: { type: 'tool', toolName: 'submit_personas' } as const,
				messages: [
					{
						role: 'user',
						content: `テーマ「${title}」について、以下の各立場を代表するペルソナを1体ずつ生成してください。\n\n【命名のルール】\n- 基本的には日本人のペルソナとして生成すること。ただしテーマが明らかに海外を舞台とする（例: F1、海外スポーツ、国際政治）場合は、そのテーマに合った国籍の人物を含めること\n- 佐藤・田中・鈴木など超頻出姓、陽菜・蓮・葵など近年多用される名前への偏りを避けること\n- 日本人名は地域性（東北・関西・九州など）や年代感（昭和・平成・令和の命名傾向の違い）をペルソナの年齢・背景に合わせて反映させること\n- 外国人ペルソナを含める場合はその国籍の実際の名前の傾向を反映させ、表記はカタカナにすること（例: ルイス・ハミルトン、カルロス・サインツ）\n- 年齢層・職業・社会的背景の多様性を確保すること\n\n立場リスト:\n${rolesDesc}\n\n各ペルソナは「実在する一人の人物」として設定してください。職業は具体的な職種・役職まで落とし込み、背景には家族構成・居住地・年収・趣味など生活の具体的なディテールを盛り込んでください。\n\n【立場の具体化（重要）】\n各ペルソナには3つの属性がある。混同しないこと。\n- stakeholderRole … 対応するステークホルダーの総称。立場リストの総称をそのまま引き継ぐ（例: F1チーム関係者）。\n- specificRole … このテーマにおける「具体的な立場・肩書き」。「F1チーム関係者」のような総称は、オーナー／レースエンジニア／メカニックなど具体的な役職に必ず特定する。「F1の熱心なファン」のように総称が既に具体的なら、それを反映する。\n- occupation … 実生活上の職業。テーマに職業として関わる人物では specificRole と一致するが、「F1の熱心なファン」のように職業外で関わる人物では、occupation がテーマと無関係（例: 市役所職員）でよい。その場合でもその人物のテーマ上の立場（specificRole）は「F1の熱心なファン」である。職業を立場と取り違えないこと。\n\n【専門・意識レベルに応じた描き分け（重要）】\n人物の「テーマに対する専門知識・意識の高さ」を、立場リストの専門・意識レベルに必ず合わせてください。全員を持論の強い専門家・当事者にしないこと。ただし、どのレベルの人物も議論には主体的に参加し、自分なりの意見を持っています。無関心・他人事の傍観者は作らないでください。\n- 専門・意識:高 → テーマを深く考え、明確な持論・専門的な視点を持つ人物として描く\n- 専門・意識:中 → 専門家ではないが一定の知識と関心を持ち、生活実感に基づく等身大の意見を持つ人物として描く\n- 専門・意識:低 → 専門知識は乏しく難しい用語は使わない人物。生活者・当事者の目線から、生活実感に根ざした素朴な意見・疑問・要望を自分なりに持つ。interests は専門用語を避け、この人物の生活に根ざした具体的な関心事として記述すること\n\nengagementLevel には、対応するステークホルダーの専門・意識レベルをそのまま設定してください。`
					}
				]
			});
		} catch (err) {
			throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
		}

		const toolCall = result.toolCalls[0];
		if (!toolCall) throw new HttpsError('internal', 'No tool call in response');

		return { personas: (toolCall.args as { personas: unknown[] }).personas };
	}
);
