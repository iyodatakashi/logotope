import { generateText, jsonSchema } from 'ai';
import { getPersonaModel } from '../llm/models.js';
import { MAX_TOKENS } from '../constants/ai.constants.js';
import { isSearchAvailable, executeSearch } from '../search/search-service.js';
import { formatHistory } from '../utils/conversation.js';
import type { DebateTurn } from '../types/debate.types.js';
import type { Persona } from '../types/persona.types.js';
import type { AgentTurnResult, BeliefChangeEvent, BeliefChangeType, PostDebateCommentResult, EngagementAssessment } from '../types/debate.types.js';
import type { Result, PipelineError } from '../types/common.types.js';
import type { TurnGenerationContext } from '../types/debate.types.js';

type ExperienceLevel = 'young' | 'mid' | 'veteran';
type AuthorityLevel = 'general' | 'mid' | 'high';

const VETERAN_KEYWORDS = ['ベテラン', 'シニア', '管理職', '教授', '博士', '専門家', '研究者'];
const YOUNG_KEYWORDS = ['新入', '学生', 'インターン', '若手', '研修'];
const HIGH_AUTHORITY_KEYWORDS = [
	'経営',
	'社長',
	'CEO',
	'代表',
	'部長',
	'局長',
	'院長',
	'教授',
	'有識者',
	'専門家',
	'弁護士',
	'医師',
	'研究者'
];
const MID_AUTHORITY_KEYWORDS = ['主任', '係長', '課長', 'マネージャー', '管理'];

function estimateExperienceLevel(age: number, occupation: string): ExperienceLevel {
	if (YOUNG_KEYWORDS.some((kw) => occupation.includes(kw)) || age <= 30) return 'young';
	if (VETERAN_KEYWORDS.some((kw) => occupation.includes(kw)) || age >= 55) return 'veteran';
	return 'mid';
}

function estimateAuthorityLevel(stakeholderRole: string): AuthorityLevel {
	if (HIGH_AUTHORITY_KEYWORDS.some((kw) => stakeholderRole.includes(kw))) return 'high';
	if (MID_AUTHORITY_KEYWORDS.some((kw) => stakeholderRole.includes(kw))) return 'mid';
	return 'general';
}

function currentDateString(): string {
	const d = new Date();
	return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function buildSpeechStyleGuide(persona: Persona & { gender?: string }): string {
	const expLevel = estimateExperienceLevel(persona.age, persona.occupation);
	const authLevel = estimateAuthorityLevel(persona.specificRole || persona.stakeholderRole);
	const lines: string[] = [];

	lines.push(
		'これは口語の対話であり、書き言葉（「〜だ」「〜である」「〜ではない」調）は使わない。'
	);

	if (expLevel === 'young') {
		lines.push(
			'「〜かな？」「そうなんですか？」「〜じゃないですか」など口語の疑問形を自然に用いる。'
		);
		lines.push('経験が少ない若手として、断言より確認・質問を多く使う。');
	} else if (expLevel === 'veteran') {
		lines.push(
			'豊富な経験を基に自信を持って話す（「〜です」「そうじゃない」「〜じゃないですか」「実際にね〜」）。'
		);
		lines.push('業界用語・専門語彙を自然に交え、経験談（「〜のとき実際に〜」）を活用する。');
	} else {
		lines.push('「〜です」「〜だと思います」など断言と確認のバランスを保つ口語で話す。');
		lines.push('具体的な事例を示しながら意見を述べる。');
	}

	if (authLevel === 'high') {
		lines.push(
			'権威ある立場として自信を持って発言する。「〜です」「そうじゃない」「〜じゃないかな」「〜というのはどう？」「それは間違いです」など口語で断言し、謙遜表現（「〜かもしれません」）は避ける。'
		);
	} else if (authLevel === 'mid') {
		lines.push(
			'組織内の立場を反映し、現場と管理側の視点を行き来しながら「〜です」「〜だと思います」で話す。'
		);
	} else {
		lines.push(
			'遠慮がちに発言し、「〜ではないかと思いますが」「〜なんじゃないですか」などの表現を自然に使う。'
		);
	}

	lines.push('画一的なビジネス敬語（「〜でございます」「〜存じます」）は避ける。');

	if (persona.gender) {
		lines.push(
			`${persona.gender}としての自然な語感を大切に、ただし性別による過度な役割固定は避ける。`
		);
	}

	return lines.join('\n');
}

function buildPersonaSystemPrompt(
	persona: Persona & { gender?: string },
	interviewRecord: string,
	currentBelief: string
): string {
	const styleGuide = buildSpeechStyleGuide(persona);
	return `あなたは以下のペルソナとして、グループインタビューに参加しています。これは討論ではなく、さまざまな立場の人が集まって、あるテーマについてそれぞれの経験や感じ方を話す場です。正しいことを言う必要はありません。自分の生活や仕事の経験から思うことを素直に話し、他の参加者の話を聞いて感じたことを返してください。

## 現在の日付
本日は ${currentDateString()} です。時事的な話題に言及する際は、この日付を基準に時間感覚を持って発言してください。

## 発言スタイルの厳守事項
${styleGuide}
- **このペルソナは討論のプロではない**。自分の意見を「正しいと証明する」必要はなく、ただ感じていること・思っていることを話しているだけ。意識が高すぎる発言・勝ちにいく発言は不自然。
- 発言は、自分の考え・意見を述べる／知っている事実・データを紹介する／直前の発言に短く反応する、のいずれかの形で行う。会話の流れに応じて自然に使い分けること。演説禁止。
- **直前の発言に反応するときは、冒頭で相手の名前を呼ばない**（「○○さんのおっしゃる通り」「○○さんが言ったように」は不要）。ただし、直前ではなく少し前の発言や別の人の話を取り上げるときは、「さっき○○さんが言っていた〜だけど」のように、誰のどの話への反応かを冒頭で示すこと。
- 自分の信念・立場に基づいて反論・疑問を呈することを恐れない。相手の意見に同意しない場合は、はっきりそう言う。同意一辺倒は不自然。
- **信念ドキュメントは内面の一貫性を保つための参照資料であり、発言で直接述べるものではない**。立場・価値観は、相手の発言の具体的な内容への反応として自然に滲み出すこと。「私の立場は〜」「私は〜と考えており」のような宣言的な表明は避ける。
- **相手が知らない前提で情報を扱う**。専門的な事例・固有名詞を出す際は「〜って知ってますか？」「〜という話があって」など、相手の理解を確認しながら導入すること。いきなり知っていて当然のように使わない。
- **会話は共通理解を積み上げるもの**。最初から高い専門知識ベースを前提にせず、相手の反応を見ながら話を展開すること。
- **知らないこと・わからないことは、知ったかぶりせず素直に「わからない」「詳しくは知らない」と言う**。自分の知識や経験を超える専門的・制度的な話題で、もっともらしく語るのは不自然。わからないなりの素朴な疑問や生活実感を返せばよく、無理に意見を作る必要はない。
- **「刺さる」という言葉は使わない**。共感や納得を表すときは「なるほど」「そうなんだ」「わかる気がする」「それは確かに」など、普通の日本人が日常会話で自然に使う素朴な言葉で話すこと。
- **「正直」「正直に言うと」を多用しない**。本音を述べる前置きとして毎回付けるのは不自然。前置きなしで率直に話せばよい。

## ペルソナプロフィール
- 名前: ${persona.name}
- 年齢: ${persona.age}歳
- 職業: ${persona.occupation}
- 立場: ${persona.specificRole || persona.stakeholderRole}
- 背景: ${persona.background}
- 関心事: ${persona.interests}

## 事前取材レコード
${interviewRecord}

## 現在の信念ドキュメント
（内面の一貫性を保つための参照資料。発言で直接引用・言及しないこと）
${currentBelief}

## 情報収集について
数値・統計・最新動向など正確性が求められる情報を発言の根拠として示す場合は、推測や記憶だけに頼らず検索ツールを積極的に使用すること。
検索クエリは自分の立場・職業・関心に沿った視点で構築すること。
検索ツールは必要なときのみ使用し、1〜2回以内にとどめること。
自分の体験・実感はそのまま語ってよい。`;
}

// 発言意欲スコア（2〜5）に応じた発言の長さ。score 不明時（指名・キュー）は中くらい。
function speechLengthGuide(score?: number): string {
	switch (score) {
		case 2:
			return '20〜50文字程度（一言）';
		case 3:
			return '50〜100文字程度';
		case 4:
			return '100〜160文字程度';
		case 5:
			return '150〜220文字程度';
		default:
			return '80〜140文字程度';
	}
}

type AnyTool = {
	description: string;
	parameters: ReturnType<typeof jsonSchema>;
	execute?: (args: { [key: string]: unknown }) => Promise<string>;
};

function buildFullTurnTools(
	styleGuide: string,
	lengthGuide: string
): Record<string, AnyTool> {
	const styleSummary = styleGuide.split('\n')[0];
	const tools: Record<string, AnyTool> = {
		submit_turn: {
			description: 'ペルソナとして1ターン分の発言を提出する',
			parameters: jsonSchema({
				type: 'object' as const,
				additionalProperties: false as const,
				properties: {
					content: {
						type: 'string' as const,
						description: `発言内容を自分の言葉で話す（${lengthGuide}）。語り口: ${styleSummary}`
					},
					beliefChangeType: {
						type: 'string' as const,
						enum: ['opinion_change', 'partial_acceptance'],
						description:
							'信念変化タイプ: opinion_change=立場・結論が完全に変わる場合、partial_acceptance=他の意見の一部を受け入れる場合。変化なしの場合は省略する'
					},
					beliefChangeSummary: {
						type: 'string' as const,
						description: '信念変化の理由・概要（beliefChangeTypeを指定した場合のみ記入）'
					},
					beliefChangeUpdatedBelief: {
						type: 'string' as const,
						description:
							'変化後の信念ドキュメント（Markdown形式。beliefChangeTypeを指定した場合のみ記入）'
					},
					addressedToPersonaId: {
						type: 'string' as const,
						description: '返答を求める特定のペルソナのID。直接質問する場合のみ指定する。'
					}
				},
				required: ['content']
			})
		}
	};

	if (isSearchAvailable()) {
		tools['web_search'] = {
			description:
				'数値・統計・最新情報など正確性が必要な情報を検索する。1〜2回以内で使用すること。',
			parameters: jsonSchema({
				type: 'object' as const,
				properties: { query: { type: 'string' as const, description: '検索クエリ（日本語可）' } },
				required: ['query']
			}),
			execute: async (args: { [key: string]: unknown }) => {
				const result = await executeSearch(args['query'] as string);
				return result.ok ? result.value : '検索結果を取得できませんでした。';
			}
		};
	}

	return tools;
}

const ASSESS_ENGAGEMENT_TOOLS = {
	assess_engagement: {
		description:
			'現在の会話を踏まえて、発言意欲（score）と発言形式（mode）を独立して自己評価する。score と mode はそれぞれ独立して選択すること。',
		parameters: jsonSchema({
			type: 'object' as const,
			additionalProperties: false as const,
			properties: {
				score: {
					type: 'integer' as const,
					description:
						'発言意欲の強度（1〜5の整数）。mode ごとのスコアラベルを参照して選択すること。'
				},
				mode: {
					type: 'string' as const,
					enum: ['fact', 'opinion', 'none'],
					description: `発言形式（score とは独立して選択する）。score の強さがそのまま発言の長さになる（低い＝一言、高い＝しっかり）。

【mode の選び方】
1. 相手に紹介すべき事実・データ・調査結果を持っているなら → fact
2. それ以外で、自分の考え・意見・実感を述べたいなら → opinion
まず「紹介できる事実があるか」を先に確認し、あれば fact を優先する。付け加える中身がなく発言する必要がなければ score 1（none）。

fact（リサーチ・事実・データに基づく説明をする発言。皆が知っている前提にせず、相手に紹介・共有するトーンで話す）:
  score 1: 説明しなくてよい（共有すべき事実・データがない）
  score 2: 補足したい（関連する事実を一言添えたい）
  score 3: 説明したい（自分が知っている事実・データを紹介したい）
  score 4: ぜひ説明したい（議論に欠けている重要な事実・データを共有したい）
  score 5: すぐ説明したい（誤解や事実誤認があり、正確な情報を今すぐ伝えたい）

opinion（自分の考え・意見・実感を展開する発言）:
  score 1: 発言しなくてよい（この話題に付け加えることがない）
  score 2: 発言してもよい（自分の立場・感じ方を一言だけ述べたい）
  score 3: 発言したい（自分の体験・実感・専門のいずれかから言いたいことがある）
  score 4: ぜひ発言したい（自分の生活・仕事・専門に関わる話題で、思うことを伝えたい）
  score 5: すぐ発言したい（自分の立場・生活・専門に強く関わり、黙っていられない）

none: score 1 のときのみ選択する`
				},
				intentSummary: {
					type: 'string' as const,
					description:
						'opinion / fact の場合は80文字以内で「今伝えたいこと」を要約する。mode が none の場合は省略する。'
				}
			},
			required: ['score', 'mode']
		})
	}
} as const;

const POST_DEBATE_COMMENT_TOOLS = {
	submit_post_debate_comment: {
		description: 'ペルソナとして討論後の短いコメントを提出する（2〜4文）',
		parameters: jsonSchema({
			type: 'object' as const,
			additionalProperties: false as const,
			properties: {
				content: {
					type: 'string' as const,
					description:
						'討論後コメント（2〜4文）: 他の参加者の意見を聞いてどう感じたか・印象に残った意見・自分の考えの変化を含める'
				}
			},
			required: ['content']
		})
	}
} as const;

export async function generateTurn(
		persona: Persona,
		currentBelief: string,
		interviewRecord: string,
		context: TurnGenerationContext
	): Promise<Result<AgentTurnResult, PipelineError>> {
		try {
			const { chapter, pendingTrigger, intentSummary, nominatedByFacilitator } = context;
			const recentHistory = context.chapterHistory.slice(-20);
			const styleGuide = buildSpeechStyleGuide(persona);
			const chapterContext = `\n\n【この章のフォーカス】「${chapter.title}」: ${chapter.focusQuestion}`;
			const pendingNote = pendingTrigger
				? `\n\n【持ち越しの言いたいこと】少し前に${pendingTrigger.speakerName}が「${pendingTrigger.content.slice(0, 80)}」と言ったのを聞いて、あなたはこれに何か言いたいと思っていました。会話の流れに沿って、適切であればこの話題に触れてください。`
				: '';
			const intentNote = intentSummary ? `\n\n【今回伝えたいこと】${intentSummary}` : '';
			const nominationNote = nominatedByFacilitator
				? '\n\n【指名】ファシリテーターが直接あなたに話を向けました。この問いかけに対して、自分の立場・生活・仕事の経験から具体的に答えてください。'
				: '';

			const isFact = context.mode === 'fact';
			const system = buildPersonaSystemPrompt(persona, interviewRecord, currentBelief);
			const llmType = persona.llmType ?? 'claude';

			const lastSpeakerName = recentHistory[recentHistory.length - 1]?.speakerName;
			const lastSpeakerNote = lastSpeakerName
				? `\n\n直前の発言は${lastSpeakerName}によるものです。${lastSpeakerName}に反応する場合は冒頭で名前を呼ばず、それより前の別の人の発言を取り上げるときだけ「さっき○○さんが言っていた〜」と名前を添えること。`
				: '';

			const lengthGuide = speechLengthGuide(context.score);
			const fullTools = buildFullTurnTools(styleGuide, lengthGuide);
			const opinionInstruction = `${persona.name}として発言してください。思ったこと・感じたことを自分の言葉で話す（${lengthGuide}）。信念に変化があれば beliefChangeType を指定。直接質問する場合のみ addressedToPersonaId を指定。`;
			const factInstruction = `${persona.name}として、自分が知っている事実・データ・調査結果を相手に紹介してください（${lengthGuide}）。これは意見ではなく事実の共有です。自分の賛否・評価・主張は加えず、事実・データそのものを客観的に述べること（「私はこう思う」「〜すべきだ」は禁止）。皆が知っている前提にせず、「〜という調査があって」「〜って知ってますか？」のように、知らない相手に共有・説明するトーンで話す。検索ツールで確認した情報は根拠として使ってよい。確認していない情報は断言しない。直接質問する場合のみ addressedToPersonaId を指定。`;
			const userContent = `討論の現在の状況:\n\n${formatHistory(recentHistory)}${chapterContext}${lastSpeakerNote}${pendingNote}${intentNote}${nominationNote}\n\n${isFact ? factInstruction : opinionInstruction}`;
			const callFull = (model: ReturnType<typeof getPersonaModel>) =>
				generateText({
					model,
					maxTokens: MAX_TOKENS.PERSONA_TURN,
					system,
					tools: fullTools,
					toolChoice: 'required' as const,
					maxSteps: 4,
					messages: [{ role: 'user', content: userContent }],
					providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } }
				});
			let fullResult;
			try {
				fullResult = await callFull(getPersonaModel(llmType));
				const hasSubmitTurn = fullResult.steps
					.flatMap((s) => s.toolCalls)
					.some((c) => c.toolName === 'submit_turn');
				if (!hasSubmitTurn && llmType !== 'claude') {
					console.error(`[llm] no submit_turn: ${llmType}, falling back to claude`);
					fullResult = await callFull(getPersonaModel('claude'));
				}
			} catch (err) {
				console.error(`[llm] provider error: ${llmType} - ${err}`);
				fullResult = await callFull(getPersonaModel('claude'));
			}

			const allToolCalls = fullResult.steps.flatMap((s) => s.toolCalls);
			const toolCall = allToolCalls.find((c) => c.toolName === 'submit_turn');
			if (!toolCall) {
				return {
					ok: false,
					error: { code: 'AI_API_ERROR', message: 'No tool call in response', retryable: true }
				};
			}

			const searchCalls = allToolCalls.filter((c) => c.toolName === 'web_search');
			const searchQueries = searchCalls.map((c) => (c.args as { query: string }).query);

			const {
				content,
				beliefChangeType,
				beliefChangeSummary,
				beliefChangeUpdatedBelief,
				addressedToPersonaId
			} = toolCall.args as {
				content: string;
				beliefChangeType?: BeliefChangeType;
				beliefChangeSummary?: string;
				beliefChangeUpdatedBelief?: string;
				addressedToPersonaId?: string;
			};
			const beliefChange: BeliefChangeEvent | null = beliefChangeType
				? {
						type: beliefChangeType,
						summary: beliefChangeSummary ?? '',
						updatedBelief: beliefChangeUpdatedBelief ?? ''
					}
				: null;
			return {
				ok: true,
				value: {
					content,
					speechMode: isFact ? 'fact' : 'opinion',
					beliefChange,
					addressedToPersonaId,
					...(searchQueries.length > 0 && {
						searchUsed: true,
						searchQueries
					})
				}
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
		}
}

export async function assessEngagement(
	persona: Persona,
	currentBelief: string,
	interviewRecord: string,
	history: DebateTurn[]
): Promise<Result<EngagementAssessment, PipelineError>> {
		try {
			const recentHistory = history.slice(-8);
			const ownTurns = history.filter((t) => t.personaId === persona.id).slice(-5);
			const ownTurnsSection =
				ownTurns.length > 0
					? `\nあなた（${persona.name}）のこれまでの発言:\n${formatHistory(ownTurns)}\n`
					: '';
			const result = await generateText({
				model: getPersonaModel(persona.llmType ?? 'claude'),
				maxTokens: MAX_TOKENS.PERSONA_ENGAGEMENT,
				system: buildPersonaSystemPrompt(persona, interviewRecord, currentBelief),
				tools: ASSESS_ENGAGEMENT_TOOLS,
				toolChoice: { type: 'tool', toolName: 'assess_engagement' },
				providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
				messages: [
					{
						role: 'user',
						content: `現在の会話:\n\n${formatHistory(recentHistory)}${ownTurnsSection}\n${persona.name}として、自分の信念に照らして発言意欲（score）と発言形式（mode）を独立して評価してください。score は mode ごとのスコアラベルに素直に当てはめて選んでください。score の強さがそのまま発言の長さになります（低い＝一言、高い＝しっかり）。mode は、まず相手に紹介すべき事実・データを持っているなら fact、そうでなく自分の考え・意見・実感を述べたいなら opinion を選びます。発言意欲は「このテーマが自分の生活・立場・実感にどれだけ関わるか」で決まり、専門知識の有無では決めません。専門知識がなくても、素朴な疑問・違和感・生活実感があれば高く評価してよく、逆に専門家でもその話題に関心がなければ低くてかまいません。すでに同じ論点・主張を述べており、新たに付け加えるべきことがなければ score 1（発言しなくてよい）を選んでください。`
					}
				]
			});

			const toolCall = result.toolCalls[0];
			if (!toolCall) {
				return { ok: true, value: { score: 1, mode: 'none' } };
			}

			const { score, mode, intentSummary } = toolCall.args as {
				score: number;
				mode: 'opinion' | 'fact' | 'none';
				intentSummary?: string;
			};
			const clampedScore = Math.max(1, Math.min(5, Math.round(score)));
			const resolvedMode: 'opinion' | 'fact' | 'none' = clampedScore === 1 ? 'none' : mode;
			const resolvedIntentSummary = resolvedMode === 'none' ? undefined : intentSummary;
			return {
				ok: true,
				value: { score: clampedScore, mode: resolvedMode, intentSummary: resolvedIntentSummary }
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
		}
}

export async function generatePostDebateComment(
	persona: Persona,
	finalBelief: string,
	history: DebateTurn[]
): Promise<Result<PostDebateCommentResult, PipelineError>> {
		try {
			const result = await generateText({
				model: getPersonaModel(persona.llmType ?? 'claude'),
				maxTokens: MAX_TOKENS.PERSONA_POST_DEBATE,
				system: buildPersonaSystemPrompt(persona, '', finalBelief),
				tools: POST_DEBATE_COMMENT_TOOLS,
				toolChoice: { type: 'tool', toolName: 'submit_post_debate_comment' },
				messages: [
					{
						role: 'user',
						content: `以下の討論全体を踏まえて、${persona.name}として討論後のコメントを2〜4文で述べてください。他の参加者の意見を聞いてどう感じたか、印象に残った意見、自分の考えの変化を含めてください。\n\n討論全体:\n${formatHistory(history)}`
					}
				]
			});

			const toolCall = result.toolCalls[0];
			if (!toolCall) {
				return {
					ok: false,
					error: { code: 'AI_API_ERROR', message: 'No tool call in response', retryable: true }
				};
			}

			const { content } = toolCall.args as { content: string };
			return { ok: true, value: { personaId: persona.id, content } };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
		}
}
