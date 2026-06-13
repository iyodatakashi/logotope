import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { generateText, jsonSchema } from 'ai';
import { getPipelineModel } from '../llm/models.js';
import { requireAuth } from '../utils/auth.js';
import { MAX_TOKENS } from '../config/ai.js';
import type { Stakeholder } from '../types/index.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

const buildPersonaTools = (count: number) => ({
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
              stakeholderRole: { type: 'string' as const, description: 'どの立場に対応するか' },
              name: { type: 'string' as const, description: '氏名（テーマ・ステークホルダーの国際的文脈に合った名前。グローバルなテーマでは多国籍の名前を使う）' },
              nationality: { type: 'string' as const, description: '国籍・出身国' },
              age: { type: 'integer' as const, description: '年齢' },
              occupation: { type: 'string' as const, description: '具体的な職種・役職（例: 中学校の理科教師、物流会社の経理担当、フリーランスのWebデザイナー）。カテゴリ名や職種の列挙は禁止。1つの具体的な職業のみ記入' },
              background: { type: 'string' as const, description: '人物像を具体的に描写（200字以内）。家族構成・居住地・年収・趣味・生活習慣など、この人物をリアルに想像できる情報を盛り込む。例：「妻と小学生の子ども2人の4人家族。埼玉県の一戸建てに住む。年収600万円台。週末はサッカーコーチとして地域の少年団に関わる。」' },
              interests: { type: 'string' as const, description: 'テーマに対して持つ具体的な関心事・懸念・期待（200字以内）。抽象的な価値観ではなく、この人物の生活・立場から生まれる具体的な視点を記述する' },
              stanceDirection: { type: 'string' as const, description: 'テーマへのスタンス方向' },
              engagementLevel: { type: 'string' as const, enum: ['high', 'medium', 'low'], description: '対応するステークホルダーの関与度をそのまま引き継ぐ。high=明確な持論を持つ当事者、medium=一定の関心はあるが専門的でない、low=テーマに薄く関わるだけで意見は曖昧な一般層' },
              llmType: {
                type: 'string' as const,
                enum: ['gemini', 'claude', 'gpt'],
                description: 'gemini=最新情報重視・SNS世論に敏感(記者・アナリスト・活動家等)、claude=学術・論理重視(研究者・教授等)、gpt=バランス型(一般市民・会社員等)',
              },
            },
            required: ['stakeholderRole', 'name', 'nationality', 'age', 'occupation', 'background', 'interests', 'stanceDirection', 'engagementLevel', 'llmType'],
          },
        },
      },
      required: ['personas'],
    }),
  },
} as const);

export const generatePersonas = onCall({ timeoutSeconds: 300, secrets: SECRETS }, async (request) => {
  requireAuth(request);
  const { title, stakeholders } = request.data as { title: string; stakeholders: Stakeholder[] };
  if (!title?.trim()) throw new HttpsError('invalid-argument', 'title is required');
  if (!stakeholders?.length) throw new HttpsError('invalid-argument', 'stakeholders is required');

  const engagementLabel = (level?: string) =>
    level === 'high' ? '関与度:高' : level === 'low' ? '関与度:低' : '関与度:中';
  const rolesDesc = stakeholders
    .map((s, i) => `${i + 1}. ${s.role}（${s.stanceDirection} / ${engagementLabel(s.engagementLevel)}）`)
    .join('\n');

  let result;
  try {
    result = await generateText({
      model: getPipelineModel('personaGenerator'),
      maxTokens: MAX_TOKENS.PERSONA,
      tools: buildPersonaTools(stakeholders.length),
      toolChoice: { type: 'tool', toolName: 'submit_personas' } as const,
      messages: [{
        role: 'user',
        content: `テーマ「${title}」について、以下の各立場を代表するペルソナを1体ずつ生成してください。\n\n【命名のルール】\n- 基本的には日本人のペルソナとして生成すること。ただしテーマが明らかに海外を舞台とする（例: F1、海外スポーツ、国際政治）場合は、そのテーマに合った国籍の人物を含めること\n- 佐藤・田中・鈴木など超頻出姓、陽菜・蓮・葵など近年多用される名前への偏りを避けること\n- 日本人名は地域性（東北・関西・九州など）や年代感（昭和・平成・令和の命名傾向の違い）をペルソナの年齢・背景に合わせて反映させること\n- 外国人ペルソナを含める場合はその国籍の実際の名前の傾向を反映させ、表記はカタカナにすること（例: ルイス・ハミルトン、カルロス・サインツ）\n- 年齢層・職業・社会的背景の多様性を確保すること\n\n立場リスト:\n${rolesDesc}\n\n各ペルソナは「実在する一人の人物」として設定してください。職業は具体的な職種・役職まで落とし込み、背景には家族構成・居住地・年収・趣味など生活の具体的なディテールを盛り込んでください。\n\n【関与度に応じた描き分け（重要）】\n人物の「テーマへの関心の濃さ」は、立場リストの関与度に必ず合わせてください。全員を持論の強い専門家・当事者にしないこと。\n- 関与度:高 → テーマを深く考え、明確な持論・専門的な視点を持つ人物として描く\n- 関与度:中 → 一定の関心はあるが専門家ではなく、生活実感に基づく等身大の意見を持つ人物として描く\n- 関与度:低 → テーマに薄く影響を受けるだけで、普段ほとんど意識していない一般層。interests は「正直よくわからない」「なんとなく不安／気にしていない」といった曖昧で生活者目線の関心として記述し、専門用語や強い主張を持たせないこと\n\nengagementLevel には、対応するステークホルダーの関与度をそのまま設定してください。`,
      }],
    });
  } catch (err) {
    throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
  }

  const toolCall = result.toolCalls[0];
  if (!toolCall) throw new HttpsError('internal', 'No tool call in response');

  return { personas: (toolCall.args as { personas: unknown[] }).personas };
});
