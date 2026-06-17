import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS, MAX_TOKENS } from '../constants/ai.constants.js';
import { formatTurns, formatPersonas } from '../utils/conversation.js';
import type { DebateTurn } from '../types/debate.types.js';
import type { Persona } from '../types/persona.types.js';
import type { FacilitatorReply, Chapter } from '../types/debate.types.js';
import type { Result, PipelineError } from '../types/common.types.js';

const client = new Anthropic();

function currentDateString(): string {
	const d = new Date();
	return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function buildNeutralitySystemPrompt(): string {
	return (
		`本日は ${currentDateString()} です。時事的な話題に言及する際はこの日付を基準にしてください。` +
		'あなたはテレビ討論番組のプロの司会者です。特定の立場への誘導は禁止しますが、議論を具体的な論点に絞り込んで進行するのがあなたの役割です。' +
		'「建設的な議論を」「様々な視点から」のような抽象的な言葉は使わない。' +
		'常に「〜についてはどうですか？」「〜という点で○○さんはどう思いますか？」のように具体的な問いかけで誘導する。' +
		'発言は2〜3文以内。演説禁止。'
	);
}

// 先に指名先（targetPersonaId）を確定させてから content を書かせる（呼びかけと ID の不一致防止）
const OPENING_TOOL: Anthropic.Tool = {
	name: 'submit_opening',
	description: '最初に発言させるペルソナを決めてから、討論の冒頭発言を提出する',
	input_schema: {
		type: 'object' as const,
		properties: {
			targetPersonaId: {
				type: 'string',
				description:
					'最初に発言させるペルソナのID（参加者リストのIDをそのまま指定）。先にここで指名先を確定させてから content を書くこと'
			},
			content: {
				type: 'string',
				description:
					'ファシリテーターの冒頭発言テキスト。targetPersonaId の参加者に名前で呼びかけて問いを向ける'
			}
		},
		required: ['targetPersonaId', 'content']
	}
};

// プロパティの定義順 = LLM の生成順。先に指名先（targetPersonaId）を確定させてから
// content を書かせることで、文中の呼びかけと指名 ID の不一致・ID 漏れを防ぐ
const INTERVENTION_TOOL: Anthropic.Tool = {
	name: 'evaluate_intervention',
	description:
		'ファシリテーターとして可視介入が必要か判断する。介入する場合のみ targetPersonaId と content を返す。介入しない場合は両方省略する',
	input_schema: {
		type: 'object' as const,
		properties: {
			targetPersonaId: {
				type: 'string',
				description:
					'次の論点を振る参加者のID。参加者リストに記載されたIDをそのまま指定する（名前ではなくID）。介入する場合のみ指定。先にここで指名先を確定させてから content を書くこと'
			},
			content: {
				type: 'string',
				description:
					'ファシリテーターの介入発言テキスト。targetPersonaId の参加者に「○○さん、〜についてはどうですか？」のように必ず名前で呼びかける。介入する場合のみ指定'
			}
		},
		required: []
	}
};

const CLOSING_TOOL: Anthropic.Tool = {
	name: 'submit_closing',
	description: '討論のクロージング発言を提出する',
	input_schema: {
		type: 'object' as const,
		properties: {
			content: { type: 'string', description: 'ファシリテーターのクロージング発言テキスト' }
		},
		required: ['content']
	}
};

const runInterventionCheck = async (
	turns: DebateTurn[],
	personas: Persona[],
	currentChapter: Chapter | undefined,
	criteriaSection: string
): Promise<Result<FacilitatorReply, PipelineError>> => {
	try {
		const chapterContext = currentChapter
			? `\n\n【この章のミッション】「${currentChapter.title}」\nフォーカス問い: ${currentChapter.focusQuestion}\n司会の役割: この章の間、会話が常にこのフォーカス問いに関連するよう誘導する。`
			: '';

		const response = await client.messages.create({
			model: AI_MODELS.SONNET,
			max_tokens: MAX_TOKENS.FACILITATOR_INTERVENTION,
			system: buildNeutralitySystemPrompt(),
			tools: [INTERVENTION_TOOL],
			tool_choice: { type: 'tool', name: 'evaluate_intervention' },
			messages: [
				{
					role: 'user',
					content: `現在の討論を評価し、司会として介入すべきか判断してください。\n\n会話履歴（現在の章のみ）:\n${formatTurns(turns.slice(-20))}\n\n参加者:\n${formatPersonas(personas)}${chapterContext}${criteriaSection}`
				}
			]
		});

		const toolBlock = response.content.find(
			(b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
		);
		if (!toolBlock) {
			return {
				ok: false,
				error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true }
			};
		}

		const { content, targetPersonaId } = toolBlock.input as FacilitatorReply;
		return { ok: true, value: { content, targetPersonaId } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

export const generateOpening = async (
	topicTitle: string,
	personas: Persona[],
	firstChapter?: Chapter
): Promise<Result<FacilitatorReply, PipelineError>> => {
	try {
		const chapterContext = firstChapter
			? `\n\n第1章「${firstChapter.title}」のフォーカス: ${firstChapter.focusQuestion}`
			: '';
		const response = await client.messages.create({
			model: AI_MODELS.SONNET,
			max_tokens: MAX_TOKENS.FACILITATOR_OPENING,
			system: buildNeutralitySystemPrompt(),
			tools: [OPENING_TOOL],
			tool_choice: { type: 'tool', name: 'submit_opening' },
			messages: [
				{
					role: 'user',
					content: `テーマ「${topicTitle}」の討論を開始してください。\n\n参加者:\n${formatPersonas(personas)}${chapterContext}\n\n冒頭発言（2〜3文）の構成：\n1. 第1章のフォーカス問いの趣旨に沿って、「このテーマに詳しくない人でも感覚的に答えられる」オープンな問いかけをする。固有名詞（特定の映像作品・企業名・人名・統計）や専門用語を使わないこと。誰もが「自分の立場から答えられそう」と感じる入口となる問いにする。\n2. 最初の発言者にその問いを向ける\n\n「議論を始めましょう」などの抽象的な言葉は禁止。専門知識なしでも答えられる具体的な問いで始める。targetPersonaIdには必ず上記リストのIDを使用してください。`
				}
			]
		});

		const toolBlock = response.content.find(
			(b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
		);
		if (!toolBlock) {
			return {
				ok: false,
				error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true }
			};
		}

		const { content, targetPersonaId } = toolBlock.input as FacilitatorReply;
		return { ok: true, value: { content, targetPersonaId } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

/** A（論点ずれ）: 会話がフォーカス問いから逸脱しているときだけ介入し、論点を引き戻す。指名済みターンでも上書きしうる */
export const evaluateTopicDrift = async (
	turns: DebateTurn[],
	personas: Persona[],
	speakCount: Map<string, number> = new Map(),
	currentChapter?: Chapter
): Promise<Result<FacilitatorReply, PipelineError>> => {
	const speakCountInfo = personas
		.map((p) => `${p.name}: ${speakCount.get(p.id) ?? 0}回`)
		.join(', ');
	const criteria = `\n\n累計発言数: ${speakCountInfo}\n\n会話がこの章のフォーカス問いから明確に逸脱している（別の話題に流れている）場合のみ介入してください。逸脱していなければ content と targetPersonaId は省略してください。\n\n介入する場合は、フォーカス問いに引き戻す論点を決め、ふさわしい参加者を1人選んで targetPersonaId に設定してください。content は、まず話が逸れていることに触れて「すみません、少し話を戻しましょう」「本題に戻すと」のように本題への引き戻しを明示してから、その人に「○○さん、〜についてはどうですか？」と名前で呼びかけて具体的に問いかけてください。`;
	return runInterventionCheck(turns, personas, currentChapter, criteria);
};

/** B（出尽くし）: 今の論点で議論が落ち着いたとき、まだ議論されていない新しい論点に切り替えて次の話者を振る */
export const evaluateStallIntervention = async (
	turns: DebateTurn[],
	personas: Persona[],
	speakCount: Map<string, number> = new Map(),
	currentChapter?: Chapter
): Promise<Result<FacilitatorReply, PipelineError>> => {
	const speakCountInfo = personas
		.map((p) => `${p.name}: ${speakCount.get(p.id) ?? 0}回`)
		.join(', ');
	const criteria = `\n\n累計発言数: ${speakCountInfo}\n\nこの章の今の論点は議論が出尽くし、落ち着いています。まだ十分に議論されていない新しい論点に切り替えて、特定の参加者に振ってください。章をいつ終えるかはあなたの判断対象外です。\n\n手順：\n(1) この章のフォーカス問いに沿って、まだ十分に議論されていない新しい論点を決める。\n(2) その論点を話すのにふさわしい参加者を1人選び、targetPersonaId に参加者リストのIDを設定する（必須）。基準: 関連性が高い人。同程度なら発言数の少ない人を優先。\n(3) content を書く。targetPersonaId の参加者に「○○さん、〜についてはどうですか？」のように名前で呼びかけ、(1)で決めた論点に関する具体的な問いかけにする。\n\n適切な切り替え先が無ければ content と targetPersonaId は省略してください。`;
	return runInterventionCheck(turns, personas, currentChapter, criteria);
};

export const generateClosing = async (
	turns: DebateTurn[],
	finalBeliefs: Map<string, string>
): Promise<Result<string, PipelineError>> => {
	try {
		const beliefsSummary = Array.from(finalBeliefs.entries())
			.map(([id, belief]) => `ペルソナ ${id}:\n${belief}`)
			.join('\n\n');

		const response = await client.messages.create({
			model: AI_MODELS.SONNET,
			max_tokens: MAX_TOKENS.FACILITATOR_CLOSING,
			system: buildNeutralitySystemPrompt(),
			tools: [CLOSING_TOOL],
			tool_choice: { type: 'tool', name: 'submit_closing' },
			messages: [
				{
					role: 'user',
					content: `討論が終了しました。クロージング発言を3〜4文で作成してください（簡潔な締め括りのみ。長い総括は不要）。\n\n会話全体:\n${formatTurns(turns)}\n\n各参加者の最終信念:\n${beliefsSummary}`
				}
			]
		});

		const toolBlock = response.content.find(
			(b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
		);
		if (!toolBlock) {
			return {
				ok: false,
				error: { code: 'AI_API_ERROR', message: 'No tool_use block in response', retryable: true }
			};
		}

		const { content } = toolBlock.input as { content: string };
		return { ok: true, value: content };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};
