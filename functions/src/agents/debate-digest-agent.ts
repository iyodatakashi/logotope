import { generateText } from 'ai';
import { sonnet } from '../llm/models.js';
import { formatTurns } from '../utils/prompt-formatters.js';
import type { DebateTurn } from '../types/turn.types.js';
import type { Persona } from '../types/persona.types.js';
import type { Result, PipelineError } from '../types/common.types.js';

// 討論ダイジェスト用の章要約エージェント。1章分の会話を、意味・立場・帰属を保ったまま
// 中立に圧縮した散文へ要約する。結論・優劣・特定立場の支持/否定は含めない（消費者中立）。
// イントロ・アウトロ固有の意図は持ち込まず、将来の事後コメント生成でも再利用できる形に保つ。
// 章の turns を会話として一般的に扱い、章まとめ・締め発言ターンの存在に依存しない。

const summarizeChapterSystemPrompt = `あなたは討論の記録を要約する中立の編集者です。1つの章の会話を、後で討論全体を俯瞰するための材料として、意味・立場・帰属を保ったまま簡潔な散文へ圧縮してください。

【必ず守る（中立・非結論）】
- 結論・優劣・勝敗・落としどころを出さない。どの立場が正しい/優れているとも書かない。
- 特定の立場を支持・否定しない。論点と、それに対して示された立場の広がりを中立に記述する。
- 誰がどの立場・主張を述べたかの帰属を保持する（話者を取り違えない）。
- 会話に現れた内容だけを圧縮する。新たな主張・事実・評価を加えない。

【行う（圧縮）】
- 冗長な繰り返し・前置きを削り、章で交わされた論点と示された立場を簡潔な散文にまとめる。
- 特定の導入・結びの語り口を先取りしない。中立な要約に徹する。
- 原文と同じ言語で書く。`;

export const summarizeChapter = async (input: {
	title: string;
	agenda: string[];
	turns: ReadonlyArray<DebateTurn>;
	personas: ReadonlyArray<Persona>;
}): Promise<Result<string, PipelineError>> => {
	try {
		const pointsSection =
			input.agenda.length > 0
				? `\n\nこの章の論点:\n${input.agenda.map((point) => `- ${point}`).join('\n')}`
				: '';

		const result = await generateText({
			model: sonnet,
			system: summarizeChapterSystemPrompt,
			messages: [
				{
					role: 'user',
					content: `章「${input.title}」の会話を、意味・立場・帰属を保ったまま中立に圧縮した散文へ要約してください。結論・優劣・特定立場の支持や否定は含めないでください。${pointsSection}\n\n【会話（時系列順）】\n${formatTurns(input.turns, input.personas)}`
				}
			]
		});

		const summary = result.text.trim();
		if (!summary) {
			return {
				ok: false,
				error: {
					code: 'AI_API_ERROR',
					message: 'summarizeChapter returned empty text',
					retryable: true
				}
			};
		}
		return { ok: true, value: summary };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};
