import { generateObject } from 'ai';
import { z } from 'zod';
import { sonnet } from '../llm/models.js';
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

// 章編集・散文編集で共有する編集スタンス。積極的に整え、意味・立場・帰属・人物像は保持する。
// 口ごとの追加ルール（章の構造ルール／散文ルール）はこの下に個別に足す。
const editingStance = `あなたは討論の書き起こしを、読み物として通用する水準まで書き直す熟練の編集者です。原文をなるべく残すことがあなたの仕事ではありません。意味を保ったまま、締まった読みやすい文章へと積極的に書き直すのがあなたの仕事です。語尾や単語を差し替えるだけの微修正は、編集をしていないのと同じです。

【書き換えの度合い（最優先）】
- 文の骨格から書き直す。冗長な前置き・言い直し・回りくどい言い回しは、簡潔で明快な文に組み立て直す。原文の語順や言い回しを温存しない。
- 原文とほぼ同じ文がそのまま残っていたら、それは編集不足とみなす。

【守るべき不変条件（これだけ）】
- 誰の発言かを取り違えない（帰属）。
- 主張・立場・結論を変えない。新しい意見・主張・結論・事実を足さない。
- 事実的主張の内容（ファクトチェック対象を含む）を変えない。

【読みやすさのための改行】
- 意味のまとまりが切り替わるところ（話題・観点・場面の転換）で改行を入れ、読み手が目で追いやすくする。段落の区切りには空行（空の1行）を入れて分ける。
- 機械的に一文ごとには改行しない。同じ話題が続く間はひとまとまりにする。短く一つの話題で完結する文章なら、無理に改行を入れなくてよい（改行はあくまで読みやすさのため）。

その人らしい話し方は、口癖や言い回しを丸ごと残すことではなく、書き直した後も「その人が言いそう」に読めれば足りる。上記以外に守るべき制約はない。編集は原文と同じ言語で行う。`;

const editChapterSystemPrompt = `${editingStance}

原本は話し言葉の書き起こしです。以下は「章」として編集するときの追加ルールです。

【この程度まで踏み込む（書き換え例）】
原文: 「えーと、そうですね、やっぱり僕としては、コストの面がまず気になるというか、正直そこが一番引っかかるところではあるんですよね。」
編集後: 「まず引っかかるのはコストです。」

【章編集で行うこと】
- 話し言葉特有の冗長な前置き・相槌・言い直し・同じ内容の繰り返しを削り、内容が変わらない限り短く書き直す（原文の長さを保つ必要はない）。
- 特にファシリテーターの発言で、逸脱を指摘したり話を引き戻すことを宣言する前置き・釈明（「すみません」「少し話を戻します」「本題に戻すと」「本筋に戻しますが」の類）は丸ごと削り、その後に続く問いかけ・振り直しの本文だけを残す。この種の前置きは簡潔に書き直すのではなく削除する。
- 相槌・中身の薄い同意・新情報のない発言は、編集成果物から除外してよい（sourceTurnIds に含めない）。
- 内容が重複しても固有の情報を含む発言は、簡潔化しつつ発言として保持する。
- 発言の除外により同一話者の発言が連続する場合、それらを1つの自然な発言に連結し、その turn の sourceTurnIds に由来する原本ターンIDをすべて列挙する。
- 言葉足らずで何を指すか分かりにくい発言は、括弧（　）で言葉を補って読み手に伝わるようにする。ただし補うのは、話し手が言おうとした内容の復元（省略された主語・目的語、指示語「それ・あれ」が指す先、前提となっている固有名詞や文脈）に限る。話し手が述べていない新しい主張・意見・事実・評価を括弧内に足してはならない。無いと意味が取りにくい箇所だけにとどめる。

【保護対象ターン（[🔒除外禁止] の印が付いた発言）】
- この印の付いた発言は、短くても・相槌や薄い同意に見えても・冗長に見えても除外しない。上の「除外してよい」よりこの規則が優先する。
- 除外しないだけで、読みやすく書き直すこと自体は行う（むしろ整えること）。必ずいずれかの編集後ターンの sourceTurnIds に、その印の付いた原本ターンIDを残すこと。

【構造の制約（正しさのための制約であり、書き換えの度合いを下げる理由にはしない）】
- 各編集後ターンの sourceTurnIds は入力ターンIDの部分集合とし、1件以上を必ず含める。
- 【最重要・厳守】1つの編集後ターンには単一の話者の発言だけをまとめる。話者（ペルソナ／ファシリテーター）の異なる原本ターンを、1つの編集後ターンの sourceTurnIds に混在させてはならない。
  - 特に、ファシリテーターの発言とペルソナの発言を1つにまとめてはならない。ファシリテーターの発言は独立した編集後ターン（sourceTurnIds はそのファシリテーターターンのみ）にするか、冗長なら除外する。
  - 異なるペルソナ（personaId が異なる）同士も1つにまとめてはならない。
  - 連結してよいのは、同一 personaId の発言が（冗長ターンの除外により）連続する場合に限る。
- 発言の時系列順序を入れ替えない。章をまたいだ移動・連結をしない。`;

const editNarrationSystemPrompt = `${editingStance}

以下は導入・締め・所感などの散文を編集するときのルールです。
- 対象は単一の連続した散文ブロック1つです。発言の分割・話者の区別・ターンの概念はありません（章編集のような構造ルールは適用しません）。
- 元の文章の要素は落とさず、読みやすく整えます。新しい情報や論評を加えず、長さを大きく変えないでください。
- 前置き・見出し・区切り線などは付けず、整えた本文だけを content に入れてください。`;

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

const editNarrationSchema = z.object({
	content: z.string()
});

// 各ターンを turn.id 付きで整形する。LLM が sourceTurnIds でこの id を参照できるようにする。
// 保護対象ターンは行頭に印を付け、除外判断が起きる場所で「これは残す」を直接見えるようにする。
const formatTurnsWithIds = (
	turns: ReadonlyArray<DebateTurn>,
	personas: ReadonlyArray<Persona>,
	protectedTurnIds: ReadonlySet<string>
): string =>
	turns
		.map((turn) => {
			const mark = protectedTurnIds.has(turn.id) ? '[🔒除外禁止] ' : '';
			if (turn.personaId) {
				const persona = personas.find((candidate) => candidate.id === turn.personaId);
				const name = persona ? persona.name : `Persona(${turn.personaId})`;
				const role = persona ? persona.role : '';
				return `${mark}[ID:${turn.id}][${name}(${role})(personaId:${turn.personaId})]: ${turn.content}`;
			}
			return `${mark}[ID:${turn.id}][ファシリテーター]: ${turn.content}`;
		})
		.join('\n');

export const editChapter = async (
	chapter: { title: string; agenda: string[]; turns: DebateTurn[] },
	personas: ReadonlyArray<Persona>,
	protectedTurnIds: ReadonlySet<string>
): Promise<Result<EditedTurnDraft[], PipelineError>> => {
	try {
		const pointsSection =
			chapter.agenda.length > 0
				? `\n\nこの章の論点:\n${chapter.agenda.map((point) => `- ${point}`).join('\n')}`
				: '';
		const protectedSection =
			protectedTurnIds.size > 0
				? `\n\n【保護対象ターンID（除外禁止・必ず由来として残す）】\n${Array.from(protectedTurnIds).join(', ')}`
				: '\n\n【保護対象ターンID】なし';

		const result = await generateObject({
			model: sonnet,
			system: editChapterSystemPrompt,
			schema: editChapterSchema,
			messages: [
				{
					role: 'user',
					content: `章「${chapter.title}」の発言を編集者観点でリライトしてください。各編集後ターンには、由来する原本ターンID（[ID:...]）を sourceTurnIds に列挙してください。${pointsSection}\n\n参加者:\n${formatPersonas([...personas])}${protectedSection}\n\n【原本ターン（時系列順）。[🔒除外禁止] の付いた発言は編集してよいが除外は不可】\n${formatTurnsWithIds(chapter.turns, personas, protectedTurnIds)}`
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
		const result = await generateObject({
			model: sonnet,
			system: editNarrationSystemPrompt,
			schema: editNarrationSchema,
			messages: [
				{
					role: 'user',
					content: `次の${label}の文章を、意味を変えずに読みやすく整えてください。\n\n【${label}】\n${draft}`
				}
			]
		});

		const text = result.object.content.trim();
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
