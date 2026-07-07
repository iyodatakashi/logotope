import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { anthropic } from '@ai-sdk/anthropic';
import { AI_MODELS } from '../constants/ai.constants.js';
import { formatPersonas } from '../utils/prompt-formatters.js';
import type { DebateTurn } from '../types/turn.types.js';
import type { Persona } from '../types/persona.types.js';
import type { Result, PipelineError } from '../types/common.types.js';

// 編集者エージェント: 章の原本ターン列を編集者観点でリライトし、由来ターンID付きの編集後ターン列を構造化出力する。
// 生ディベートは読み取りのみ。書き込み・保存・検証はパイプライン側の責務。

// 編集後ターンのドラフト（永続前）。新規 id は保存時に採番する
export type EditedTurnDraft = {
	sourceTurnIds: string[];
	speakerType: 'persona' | 'facilitator';
	personaId?: string | null;
	content: string;
	speechMode?: 'opinion' | 'fact' | 'question';
};

const editorSystemPrompt = `あなたは討論の書き起こしを整える熟練の編集者です。読み物としての質を高めることが役割ですが、以下の不変条件を絶対に守ってください。

【保持する（改変禁止）】
- 各発言の主張内容・立場・論旨。新たな意見・主張・結論・事実を加えない。
- 事実的主張の内容（ファクトチェック対象を含む）。
- 発言の帰属（誰の発言か）。話者を取り違えない。
- 発言ごとの口調・人物像（ペルソナの個性）。
- 発言内・発言間に、編集前に存在しなかった矛盾を生じさせない。

【行う（可読性向上）】
- 同一発言内および文脈上の冗長な繰り返し・不要な前置き・冗長な言い回しを取り除く。
- 意味を変えず矛盾を生じさせない範囲で、自然で読みやすい文章へリライトする。
- 内容的に重複するが固有の情報を含む発言は、簡潔化しつつ発言として保持する。
- 冗長で新たな情報を持たない発言は編集成果物から除外してよい（sourceTurnIds に含めない）。
- 発言の除外により同一話者の発言が連続する場合、それらを1つの自然な発言に連結し、その turn の sourceTurnIds に由来する原本ターンIDをすべて列挙する。

【制約】
- 保護対象ターン（後述）は除外しない。必ずいずれかの編集後ターンの sourceTurnIds に含める。
- 各編集後ターンの sourceTurnIds は入力ターンIDの部分集合とし、1件以上を必ず含める。
- 【最重要・厳守】1つの編集後ターンには単一の話者の発言だけをまとめる。話者（ペルソナ／ファシリテーター）の異なる原本ターンを、1つの編集後ターンの sourceTurnIds に混在させてはならない。
  - 特に、ファシリテーターの発言とペルソナの発言を1つにまとめてはならない。ファシリテーターの発言は独立した編集後ターン（sourceTurnIds はそのファシリテーターターンのみ）にするか、冗長なら除外する。
  - 異なるペルソナ（personaId が異なる）同士も1つにまとめてはならない。
  - 連結してよいのは、同一 personaId の発言が（冗長ターンの除外により）連続する場合に限る。
  - 悪い例: あるペルソナの発言とファシリテーターの相槌を1ターンにまとめる／ペルソナAとペルソナBの発言を1ターンにまとめる。これらは禁止。
- 発言の時系列順序を入れ替えない。章をまたいだ移動・連結をしない。
- 可読性向上のための編集が意味の保持・無矛盾と両立しない箇所に限り、原文を維持する。
- 編集は原文と同じ言語で行う。`;

const editChapterSchema = z.object({
	turns: z.array(
		z.object({
			sourceTurnIds: z.array(z.string()).min(1),
			speakerType: z.enum(['persona', 'facilitator']),
			personaId: z.string().nullish(),
			content: z.string(),
			speechMode: z.enum(['opinion', 'fact', 'question']).nullish()
		})
	)
});

// 各ターンを turn.id 付きで整形する。LLM が sourceTurnIds でこの id を参照できるようにする
const formatTurnsWithIds = (
	turns: ReadonlyArray<DebateTurn>,
	personas: ReadonlyArray<Persona>
): string =>
	turns
		.map((turn) => {
			if (turn.personaId) {
				const persona = personas.find((candidate) => candidate.id === turn.personaId);
				const name = persona ? persona.name : `Persona(${turn.personaId})`;
				const role = persona ? persona.specificRole || persona.stakeholderRole : '';
				return `[ID:${turn.id}][${name}(${role})(personaId:${turn.personaId})]: ${turn.content}`;
			}
			return `[ID:${turn.id}][ファシリテーター]: ${turn.content}`;
		})
		.join('\n');

export const editChapter = async (
	chapter: { title: string; discussionPoints: string[]; turns: DebateTurn[] },
	personas: ReadonlyArray<Persona>,
	protectedTurnIds: ReadonlySet<string>
): Promise<Result<EditedTurnDraft[], PipelineError>> => {
	try {
		const pointsSection =
			chapter.discussionPoints.length > 0
				? `\n\nこの章の論点:\n${chapter.discussionPoints.map((point) => `- ${point}`).join('\n')}`
				: '';
		const protectedSection =
			protectedTurnIds.size > 0
				? `\n\n【保護対象ターンID（除外禁止・必ず由来として残す）】\n${Array.from(protectedTurnIds).join(', ')}`
				: '\n\n【保護対象ターンID】なし';

		const result = await generateObject({
			model: anthropic(AI_MODELS.SONNET),
			system: editorSystemPrompt,
			schema: editChapterSchema,
			messages: [
				{
					role: 'user',
					content: `章「${chapter.title}」の発言を編集者観点でリライトしてください。各編集後ターンには、由来する原本ターンID（[ID:...]）を sourceTurnIds に列挙してください。${pointsSection}\n\n参加者:\n${formatPersonas([...personas])}${protectedSection}\n\n【原本ターン（時系列順）】\n${formatTurnsWithIds(chapter.turns, personas)}`
				}
			]
		});

		const value: EditedTurnDraft[] = result.object.turns.map((turn) => ({
			sourceTurnIds: turn.sourceTurnIds,
			speakerType: turn.speakerType,
			personaId: turn.personaId ?? undefined,
			content: turn.content,
			speechMode: turn.speechMode ?? undefined
		}));
		return { ok: true, value };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

// 導入・締め・所感の原本テキストを、章と同系の editorial 整えで編集後テキストにする。
// 単一の散文ブロックを意味・主張・事実を変えずに読みやすくリライトするのみ（新情報・論評を足さない）。
// 章編集と違い「要素の除外（ドロップ）」はしない。整えた本文を必ず返す（空なら失敗として扱う）。
const editNarration = async (
	label: string,
	draft: string
): Promise<Result<string, PipelineError>> => {
	try {
		const result = await generateText({
			model: anthropic(AI_MODELS.SONNET),
			system: editorSystemPrompt,
			messages: [
				{
					role: 'user',
					content: `次の${label}の文章を、意味・主張・事実を変えずに読みやすく整えてください。新しい情報や論評を加えず、長さも大きく変えないでください。整えた本文だけを返してください。\n\n【${label}】\n${draft}`
				}
			]
		});

		const text = result.text.trim();
		if (!text) {
			return {
				ok: false,
				error: { code: 'AI_API_ERROR', message: 'narration edit returned empty text', retryable: true }
			};
		}
		return { ok: true, value: text };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

export const editIntro = (draft: string): Promise<Result<string, PipelineError>> =>
	editNarration('導入', draft);

export const editOutro = (draft: string): Promise<Result<string, PipelineError>> =>
	editNarration('締め', draft);

export const editImpression = (draft: string): Promise<Result<string, PipelineError>> =>
	editNarration('所感', draft);
