import { onCall, HttpsError } from 'firebase-functions/v2/https';
import Anthropic from '@anthropic-ai/sdk';
import { tavily } from '@tavily/core';
import { requireAuth } from '../utils/auth.js';
import { AI_MODELS, MAX_TOKENS } from '../config/ai.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TAVILY_API_KEY'];

const RESEARCH_TOOL: Anthropic.Tool = {
  name: 'submit_research',
  description: 'ペルソナの初期信念ドキュメントとリサーチサマリーを提出する',
  input_schema: {
    type: 'object' as const,
    properties: {
      researchSummary: {
        type: 'string',
        description: '使用した検索クエリと収集した主な情報のサマリー（500字程度）',
      },
      initialBelief: {
        type: 'string',
        description: '初期信念ドキュメント（Markdown形式。以下の6項目を含むこと: 立場と根拠, 核心的主張, 懸念事項, 価値観, 妥協点, 変化の可能性）',
      },
    },
    required: ['researchSummary', 'initialBelief'],
  },
};

interface PersonaInput {
  name: string;
  age: number;
  occupation: string;
  stakeholderRole: string;
  background: string;
  interests: string;
}

async function fetchSearchContext(topicTitle: string, persona: PersonaInput): Promise<string> {
  const tavilyClient = tavily();
  const groundingQuery = `${persona.stakeholderRole} ${persona.occupation} 実際の問題 経験 証言 当事者の声`;
  const newsQuery = `${topicTitle} ${persona.stakeholderRole} 最新 2025 2026`;

  type SearchResult = { title: string; content: string };
  let groundingResults: SearchResult[] = [];
  let newsResults: SearchResult[] = [];

  try {
    const res = await tavilyClient.search(groundingQuery, { maxResults: 5 });
    groundingResults = res.results;
  } catch (e) {
    console.warn(`[interview] tavily failed (grounding): ${e}`);
  }

  try {
    const res = await tavilyClient.search(newsQuery, { maxResults: 5, topic: 'news' });
    newsResults = res.results;
  } catch (e) {
    console.warn(`[interview] tavily failed (news): ${e}`);
  }

  if (groundingResults.length === 0 && newsResults.length === 0) return '';

  const sections: string[] = [];
  if (groundingResults.length > 0) {
    sections.push('## 当事者の声・具体的経験');
    sections.push(groundingResults.map(r => `[${r.title}]\n${r.content}`).join('\n\n'));
  }
  if (newsResults.length > 0) {
    sections.push('## 最新動向');
    sections.push(newsResults.map(r => `[${r.title}]\n${r.content}`).join('\n\n'));
  }
  return sections.join('\n\n');
}

export const runInterview = onCall({ timeoutSeconds: 300, secrets: SECRETS }, async (request) => {
  requireAuth(request);
  const { topicTitle, persona } = request.data as { topicTitle: string; persona: PersonaInput };
  if (!topicTitle?.trim()) throw new HttpsError('invalid-argument', 'topicTitle is required');
  if (!persona?.name) throw new HttpsError('invalid-argument', 'persona is required');

  const searchContext = await fetchSearchContext(topicTitle, persona);
  const searchSection = searchContext ? `\n\n## ウェブ検索で収集した情報\n${searchContext}` : '';

  const client = new Anthropic();
  let response;
  try {
    response = await client.messages.create({
      model: AI_MODELS.OPUS,
      max_tokens: MAX_TOKENS.INTERVIEW,
      tools: [RESEARCH_TOOL],
      tool_choice: { type: 'tool', name: 'submit_research' },
      messages: [{
        role: 'user',
        content: `テーマ「${topicTitle}」について、以下のペルソナの初期信念を生成してください。${searchSection}\n\n氏名: ${persona.name}\n年齢: ${persona.age}歳\n職業: ${persona.occupation}\n立場: ${persona.stakeholderRole}\n背景: ${persona.background}\n関心事: ${persona.interests}`,
      }],
    });
  } catch (err) {
    throw new HttpsError('internal', err instanceof Error ? err.message : String(err));
  }

  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
  );
  if (!toolBlock) throw new HttpsError('internal', 'No tool_use block in response');

  const { researchSummary, initialBelief } = toolBlock.input as {
    researchSummary: string;
    initialBelief: string;
  };

  return { researchSummary, initialBelief };
});
