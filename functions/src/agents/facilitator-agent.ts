import { generateObject } from 'ai';
import { z } from 'zod';
import { sonnet } from '../llm/models.js';
import {
	formatTurns,
	formatPersonas,
	currentDateString,
	formatFactBaseSection
} from '../utils/prompt-formatters.js';
import type { DebateTurn } from '../types/turn.types.js';
import type { Persona } from '../types/persona.types.js';
import type { FacilitatorReply } from '../types/debate.types.js';
import type { Chapter } from '../types/chapter.types.js';
import type { FactBase } from '../types/factBase.types.js';

// ファシリテーター向けの事実基盤（共通前提）注記。問いかけは平易・オープンに保ち、事実の羅列や
// 固有名詞の列挙を促さない（背景把握のみ）。事実が無ければ空文字を返す（R8.1）。
const facilitatorFactBaseNote = (factBase?: FactBase): string => {
	const section = formatFactBaseSection(factBase);
	return section
		? `${section}\n（上記は背景として把握するための共通前提です。問いかけ自体は平易でオープンに保ち、事実の羅列や固有名詞の列挙はしないこと。）`
		: '';
};
import type { Result, PipelineError } from '../types/common.types.js';

export const buildNeutralitySystemPrompt = (): string =>
	`本日は ${currentDateString()} です。時事的な話題に言及する際はこの日付を基準にしてください。` +
	'あなたは公開討論のプロの司会者です。特定の立場への誘導は禁止しますが、議論を具体的な論点に絞り込んで進行するのがあなたの役割です。' +
	'「建設的な議論を」「様々な視点から」のような抽象的な言葉は使わない。' +
	'常に「〜についてはどうですか？」「〜という点で○○さんはどう思いますか？」のように具体的な問いかけで誘導する。' +
	'発言は2〜3文以内。演説禁止。';

const facilitatorReplyWithTargetSchema = z.object({
	targetPersonaId: z.string(),
	content: z.string()
});

export type AgendaAssessment =
	| { verdict: 'exhausted' } // 主要な意見・異なる立場が出て新規性が尽きた
	| { verdict: 'drifted' } // 会話が active 項目から逸脱している
	| { verdict: 'ongoing' }; // まだ深まっている＝介入不要

const agendaAssessmentSchema = z.object({
	verdict: z.enum(['exhausted', 'drifted', 'ongoing'])
});

/**
 * 判定のみ（行動なし）: アクティブなアジェンダ項目と直近の会話から
 * 「出尽くし(exhausted) / 論点ずれ(drifted) / 継続(ongoing)」の3値を返す純粋判定。
 * content・項目選択・指名は生成しない（融合介入から判定ロジックのみを抽出）。
 */
export const assessActiveAgendaItem = async (
	activeAgendaItem: string,
	recentTurns: DebateTurn[],
	personas: Persona[]
): Promise<Result<AgendaAssessment, PipelineError>> => {
	try {
		const result = await generateObject({
			model: sonnet,
			system: buildNeutralitySystemPrompt(),
			schema: agendaAssessmentSchema,
			messages: [
				{
					role: 'user',
					content: `現在の討論を評価し、いまの論点「${activeAgendaItem}」の状態を判定してください。発言の生成や次の論点の選択・指名は行わず、判定だけを返してください。\n\n会話履歴（現在の章のみ）:\n${formatTurns(recentTurns.slice(-20), personas)}\n\n参加者:\n${formatPersonas(personas)}\n\n【三択判定】会話の流れを踏まえ、次のいずれかを verdict として返してください:\n- exhausted: いまの論点について主要な意見や異なる立場がひととおり出ており、最近のやり取りが新しい視点・論拠・具体例を加えていない（やり取りに新たな発展性がない＝出尽くし）\n- drifted: 会話がいまの論点から明確に逸脱している（別の話題にずれて流れている）\n- ongoing: まだ新しい視点・論拠・具体例が出ており、本題に沿って議論が深まっている最中（介入不要）\n\nexhausted と ongoing を混同しないこと。直前の流れをもう少し深掘りしたい・流れが生きていると感じるなら ongoing を選んでください。`
				}
			]
		});

		return { ok: true, value: { verdict: result.object.verdict } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

export type InterventionAction =
	| { kind: 'introduce'; untouchedAgendaItems: string[] } // リストから1件選び投入
	| { kind: 'pull-back'; activeAgendaItem: string }; // active へ引き戻す

export type InterventionUtterance = {
	content: string;
	targetPersonaId: string;
	selectedAgendaItemIndex?: number; // introduce のときのみ（untouched リスト上の index）
};

const introduceUtteranceSchema = z.object({
	content: z.string(),
	targetPersonaId: z.string(),
	selectedAgendaItemIndex: z.number()
});

const utteranceSchema = z.object({
	content: z.string(),
	targetPersonaId: z.string()
});

/**
 * 行動（発言生成）: 決定済みの介入行動について司会発言・指名先を生成する。
 * - introduce: 未提示リスト内の1件を選び、その論点そのものに正面から切り込む問いを返す（折衷禁止・リスト外発明禁止）。リストが空なら発言を生成しない。
 * - pull-back: active 論点へ引き戻す（項目投入・消化はしない）。
 */
export const generateInterventionUtterance = async (
	action: InterventionAction,
	chapter: Chapter,
	recentTurns: DebateTurn[],
	personas: Persona[]
): Promise<Result<InterventionUtterance, PipelineError>> => {
	const baseContext = `【この章のミッション】「${chapter.title}」\n\n会話履歴（現在の章のみ）:\n${formatTurns(
		recentTurns.slice(-20),
		personas
	)}\n\n参加者:\n${formatPersonas(personas)}`;

	try {
		if (action.kind === 'introduce') {
			// リストが空なら投入行動は起こさない（LLM を呼ばずに終える）
			if (action.untouchedAgendaItems.length === 0) {
				return {
					ok: false,
					error: {
						code: 'VALIDATION_ERROR',
						message: '未提示論点が無いため投入発言は生成できません',
						field: 'untouchedAgendaItems'
					}
				};
			}
			const pointsList = action.untouchedAgendaItems
				.map((point, i) => `${i}. ${point}`)
				.join('\n');
			const result = await generateObject({
				model: sonnet,
				system: buildNeutralitySystemPrompt(),
				schema: introduceUtteranceSchema,
				messages: [
					{
						role: 'user',
						content: `いまの論点は出尽くしました。次の未提示論点を1件だけ投入し、その論点そのものに正面から切り込む問いで議論を前進させてください。\n\n${baseContext}\n\n【未提示論点リスト（インデックス順）】\n${pointsList}\n\n手順:\n(1) 上記リストから投入する論点を1件選び、selectedAgendaItemIndex にそのインデックスを指定する（リスト外の論点を作らないこと）。\n(2) その論点を話すのにふさわしい参加者を1人選び、targetPersonaId に参加者リストのIDを設定する。\n(3) content は、selectedAgendaItemIndex で選んだ論点そのものを主題として正面から切り込む問いにする。targetPersonaId の参加者に「○○さん、〜についてはどうですか？」と名前で呼びかけ、その論点に話を完全に切り替えること。直前までの会話の流れを引きずった問いや、新論点の語を端々に混ぜつつ実質は流れの続きになっている中途半端な折衷は禁止です。`
					}
				]
			});
			const { content, targetPersonaId, selectedAgendaItemIndex } = result.object;
			return {
				ok: true,
				value: { content, targetPersonaId, selectedAgendaItemIndex }
			};
		}

		// pull-back
		const result = await generateObject({
			model: sonnet,
			system: buildNeutralitySystemPrompt(),
			schema: utteranceSchema,
			messages: [
				{
					role: 'user',
					content: `会話がいまの論点「${action.activeAgendaItem}」から逸脱しています。新しい論点は投入せず、いまの論点へ引き戻してください。\n\n${baseContext}\n\nふさわしい参加者を1人選んで targetPersonaId に設定し、content は「すみません、少し話を戻しましょう」「本題に戻すと」のように本題への引き戻し・振り直しを明示してから、その人に「○○さん、〜についてはどうですか？」と名前で呼びかけて、いまの論点について具体的に問いかけてください。`
				}
			]
		});
		return {
			ok: true,
			value: { content: result.object.content, targetPersonaId: result.object.targetPersonaId }
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

export const generateOpening = async (
	topicTitle: string,
	personas: Persona[],
	firstChapter?: Chapter,
	factBase?: FactBase
): Promise<Result<FacilitatorReply, PipelineError>> => {
	try {
		const hasPoints = (firstChapter?.agenda?.length ?? 0) > 0;
		// 入口は先頭論点を唯一の切り口にする。論点を持たない章は章タイトルを入口にする
		const entryPoint =
			hasPoints && firstChapter ? firstChapter.agenda[0] : firstChapter?.title;
		const entryContext = entryPoint
			? `\n\n第1章「${firstChapter!.title}」の入口となる問い: ${entryPoint}。この問いを最初の問いかけの切り口として使ってください。`
			: '';
		const factNote = facilitatorFactBaseNote(factBase);

		const result = await generateObject({
			model: sonnet,
			system: buildNeutralitySystemPrompt(),
			schema: facilitatorReplyWithTargetSchema,
			messages: [
				{
					role: 'user',
					content: `テーマ「${topicTitle}」の討論を開始してください。\n\n参加者:\n${formatPersonas(personas)}${entryContext}${factNote}\n\n冒頭発言（2〜3文）の構成：\n1. 上記の入口となる問いの趣旨に沿って、「このテーマに詳しくない人でも感覚的に答えられる」オープンな問いかけをする。固有名詞（特定の映像作品・企業名・人名・統計）や専門用語を使わないこと。誰もが「自分の立場から答えられそう」と感じる入口となる問いにする。\n2. 最初の発言者にその問いを向ける\n\n「議論を始めましょう」などの抽象的な言葉は禁止。専門知識なしでも答えられる具体的な問いで始める。targetPersonaIdには必ず上記リストのIDを使用してください。`
				}
			]
		});

		const { content, targetPersonaId } = result.object;
		return {
			ok: true,
			value: {
				content,
				targetPersonaId,
				selectedAgendaItemIndex: hasPoints ? 0 : undefined
			}
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

export const generateChapterIntroduction = async (
	nextChapter: Chapter,
	personas: Persona[],
	factBase?: FactBase
): Promise<Result<FacilitatorReply, PipelineError>> => {
	try {
		const hasPoints = (nextChapter.agenda?.length ?? 0) > 0;
		// 入口は先頭論点を唯一の切り口にする。論点を持たない章は章タイトルを入口にする
		const entryPoint = hasPoints ? nextChapter.agenda[0] : nextChapter.title;
		const entryContext = `\n\nこの章の入口となる問い: ${entryPoint}。この問いを導入の問いかけの切り口として使ってください。`;
		const factNote = facilitatorFactBaseNote(factBase);

		const result = await generateObject({
			model: sonnet,
			system: buildNeutralitySystemPrompt(),
			schema: facilitatorReplyWithTargetSchema,
			messages: [
				{
					role: 'user',
					content: `次の章「${nextChapter.title}」を始める導入発言を生成してください。前の章には触れず、この入口となる問いについて参加者に問いかける形で始めてください。最初に発言させるペルソナIDも指定してください。${entryContext}${factNote}\n\n参加者:\n${formatPersonas(personas)}\n\ntargetPersonaIdには必ず上記リストのIDを使用してください。`
				}
			]
		});

		const { content, targetPersonaId } = result.object;
		return {
			ok: true,
			value: { content, targetPersonaId, selectedAgendaItemIndex: hasPoints ? 0 : undefined }
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};

