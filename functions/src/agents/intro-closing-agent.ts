import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { AI_MODELS } from '../constants/ai.constants.js';
import { formatFactBaseSection } from '../utils/prompt-formatters.js';
import type { Result, PipelineError } from '../types/common.types.js';
import type { TopicContext } from '../types/topic.types.js';
import type { DebateDigest } from '../types/debate-digest.types.js';

// イントロ・クロージング生成エージェント。討論ダイジェスト＋テーマ文脈から、
// イントロ（テーマの位置づけ・立場の多様性・俯瞰する導入）とクロージング（論点と立場の広がりの
// 振り返り・問いを開いたまま締める）を独立に自由生成する。由来ターンID・構造検証は持たない。
// 討論は読み取りのみ。書き込み・保存はステップ層の責務。

const MAX_SOURCE_CHARS = 3_000;

export interface IntroClosingInput {
	digest: DebateDigest; // 圧縮済みの討論（全文は渡さない）
	topicContext: TopicContext; // description / sourceContents / factBase
}

const introClosingSystemPrompt = `あなたは討論を一つの読み物として仕立てる編集者です。討論全体を俯瞰し、イントロ（導入）とクロージング（結び）を書きます。以下の制約を絶対に守ってください。

【中立・非結論（厳守）】
- 結論・優劣・勝敗・落としどころを出さない。どの立場が正しい/優れている/説得力があるとも書かない。
- 特定の立場を支持・否定しない。個人の主張の是非を論じない。
- 扱うのは「論点」と「それに対する立場の広がり」であって、勝ち負けや正解ではない。
- 討論に現れていない新たな主張・事実・評価を加えない。

【文体】
- テーマや参加者に即した、落ち着いた俯瞰の語り口。プレーンな散文（見出し・箇条書き・メタ発言は使わない）。
- 討論と同じ言語で書く。`;

const introInstruction = `以下の討論ダイジェストとテーマ文脈をもとに、討論全体のイントロ（導入）を書いてください。
- このテーマがどんな問いをめぐるものかを位置づける。
- どんな立場・観点が交わされるのか、その多様性を俯瞰して示す。
- 結論や優劣は示さず、読者がこれから討論に入るための導入に徹する。`;

const closingInstruction = `以下の討論ダイジェストとテーマ文脈をもとに、討論全体のクロージング（結び）を書いてください。
- どんな論点が交わされ、どんな立場の広がりがあったかを振り返る。
- 特定の結論・決着・落としどころを示さず、問いを開いたまま締めくくる。
- 個人の主張の是非ではなく、論点と立場の広がりを扱う。`;

const formatDigest = (digest: DebateDigest): string => {
	const chapters = digest.chapters
		.map((chapter, i) => {
			const points = chapter.discussionPoints.length
				? `\n  論点: ${chapter.discussionPoints.join(' / ')}`
				: '';
			return `第${i + 1}章「${chapter.title}」${points}\n  ${chapter.summary}`;
		})
		.join('\n\n');
	const personas = digest.personas
		.map((persona) => {
			const shifts = persona.beliefShifts.length
				? `\n  討論で得た気づき: ${persona.beliefShifts.join(' / ')}`
				: '';
			return `- ${persona.name}: ${persona.stance}${shifts}`;
		})
		.join('\n');
	return `【テーマ】${digest.topicTitle}\n\n【章ごとの要約】\n${chapters}\n\n【参加者と立場】\n${personas}`;
};

const formatTopicContextSection = (topicContext: TopicContext): string => {
	const parts: string[] = [];
	if (topicContext.description) {
		parts.push(`\n【テーマの詳細説明】\n${topicContext.description}`);
	}
	if (topicContext.sourceContents?.length) {
		const sources = topicContext.sourceContents
			.map((content, i) => `--- 参考資料 ${i + 1} ---\n${content.slice(0, MAX_SOURCE_CHARS)}`)
			.join('\n\n');
		parts.push(`\n【参考資料】\n${sources}`);
	}
	parts.push(formatFactBaseSection(topicContext.factBase));
	return parts.join('\n');
};

const generate = async (
	input: IntroClosingInput,
	instruction: string
): Promise<Result<string, PipelineError>> => {
	try {
		const result = await generateText({
			model: anthropic(AI_MODELS.SONNET),
			system: introClosingSystemPrompt,
			messages: [
				{
					role: 'user',
					content: `${instruction}${formatTopicContextSection(input.topicContext)}\n\n【討論ダイジェスト】\n${formatDigest(input.digest)}`
				}
			]
		});

		const text = result.text.trim();
		if (!text) {
			return {
				ok: false,
				error: {
					code: 'AI_API_ERROR',
					message: 'intro-closing generation returned empty text',
					retryable: true
				}
			};
		}
		return { ok: true, value: text };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

export const generateIntro = (input: IntroClosingInput): Promise<Result<string, PipelineError>> =>
	generate(input, introInstruction);

export const generateClosing = (input: IntroClosingInput): Promise<Result<string, PipelineError>> =>
	generate(input, closingInstruction);
