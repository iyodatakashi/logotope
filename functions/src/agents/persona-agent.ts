import { generateText, jsonSchema } from 'ai';
import { getPersonaModel } from '../llm/models.js';
import { MAX_TOKENS } from '../config/ai.js';
import { formatHistory } from '../utils/conversation.js';
import type { DebateTurn } from '../db/repository.js';
import type {
	PersonaAttributes,
	AgentTurnResult,
	BeliefChangeEvent,
	BeliefChangeType,
	PostDebateCommentResult,
	DebateChapter,
	EngagementAssessment,
	Result,
	PipelineError
} from '../types/index.js';

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

export function buildSpeechStyleGuide(persona: PersonaAttributes & { gender?: string }): string {
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
	persona: PersonaAttributes & { gender?: string },
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
- 発言は **reaction（直前の発言への反応。相槌に加え、なぜそう感じたかを一言添える）** か **full（意見・論点をしっかり述べる）** のどちらかで行う。会話の流れに応じて自然に使い分けること。演説禁止。
- 必ず直前の誰かの発言を受けて、その内容に具体的に反応する。
- **発言の冒頭で相手の名前を呼んではいけない**（「○○さんのおっしゃる通り」「○○さんが言ったように」などは禁止）。
- 自分の信念・立場に基づいて反論・疑問を呈することを恐れない。相手の意見に同意しない場合は、はっきりそう言う。同意一辺倒は不自然。
- **信念ドキュメントは内面の一貫性を保つための参照資料であり、発言で直接述べるものではない**。立場・価値観は、相手の発言の具体的な内容への反応として自然に滲み出すこと。「私の立場は〜」「私は〜と考えており」のような宣言的な表明は避ける。
- **発言の根拠は自分が直接経験したこと・職場で見聞きしたことに限る**。立場を守るために遠い政策事例・海外制度・統計数値を持ち出すのは不自然。自分の生活や仕事の実感として話すこと。
- **相手が知らない前提で情報を扱う**。専門的な事例・固有名詞を出す際は「〜って知ってますか？」「〜という話があって」など、相手の理解を確認しながら導入すること。いきなり知っていて当然のように使わない。
- **会話は共通理解を積み上げるもの**。最初から高い専門知識ベースを前提にせず、相手の反応を見ながら話を展開すること。
- **知らないこと・わからないことは、知ったかぶりせず素直に「わからない」「詳しくは知らない」と言う**。自分の知識や経験を超える専門的・制度的な話題で、もっともらしく語るのは不自然。わからないなりの素朴な疑問や生活実感を返せばよく、無理に意見を作る必要はない。

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
${currentBelief}`;
}

const REACTION_TURN_TOOLS = {
	submit_reaction: {
		description: '直前の発言への短いリアクションを提出する（20〜60文字）',
		parameters: jsonSchema({
			type: 'object' as const,
			additionalProperties: false as const,
			properties: {
				content: {
					type: 'string' as const,
					description:
						'20〜60文字程度のリアクション。相槌だけで終わらせず、なぜそう感じたかを一言添える（「なるほど、それは確かにありそうですね」「いや、それはちょっと違うと思うな」「確かに。でも現場だと逆のことも多いんですよ」など）。新しい論点までは展開せず、直前の発言への反応にとどめる。同じ語尾・フレーズの繰り返しは禁止。'
				}
			},
			required: ['content']
		})
	}
} as const;

function buildFullTurnTools(styleGuide: string) {
	const styleSummary = styleGuide.split('\n')[0];
	return {
		submit_turn: {
			description: 'ペルソナとして1ターン分の発言を提出する',
			parameters: jsonSchema({
				type: 'object' as const,
				additionalProperties: false as const,
				properties: {
					content: {
						type: 'string' as const,
						description: `思ったこと・感じたことを自分の言葉で話す（最大200文字）。語り口: ${styleSummary}`
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
					enum: ['full', 'reaction', 'none'],
					description: `発言形式（score とは独立して選択する）。

reaction（直前の発言への反応。一言理由を添えてよいが、新論点は出さない）:
  score 1: パス（反応しない）
  score 2: 反応したい（軽い相槌・同意）
  score 3: 強く反応したい（明確な肯定・否定を一言で伝えたい）
  score 4: 鋭く反応したい（強い反論・感情的な指摘を短く伝えたい）
  score 5: 今すぐ反応しなければ（黙っていられない、即座に短く返したい）

full（自分の論点・主張を展開する発言）:
  score 1: パス（発言しない）
  score 2: 発言したい（自分の立場を簡潔に述べたい）
  score 3: しっかり発言したい（論点・根拠を整理して展開したい）
  score 4: ぜひ発言したい（重要な矛盾・新論点を正面から提示したい）
  score 5: 今すぐ発言しなければ（自分の立場・主張に強く関わる重要な論点で、強く意見を述べたい）

none: score 1 のときのみ選択する`
				},
				intentSummary: {
					type: 'string' as const,
					description:
						'mode が reaction の場合は40文字以内、full の場合は80文字以内で「今伝えたいこと」を要約する。mode が none の場合は省略する。'
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

export interface TurnGenerationContext {
	chapterHistory: ReadonlyArray<DebateTurn>;
	chapter: DebateChapter;
	mode?: 'full' | 'reaction';
	intentSummary?: string;
	pendingTrigger?: { speakerName: string; content: string };
	nominatedByFacilitator: boolean;
}

export class PersonaAgentService {
	async generateTurn(
		persona: PersonaAttributes,
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

			const isReaction = context.mode === 'reaction';
			const system = buildPersonaSystemPrompt(persona, interviewRecord, currentBelief);
			const llmType = persona.llmType ?? 'claude';

			if (isReaction) {
				const userContent = `討論の現在の状況:\n\n${formatHistory(recentHistory)}${chapterContext}${pendingNote}${intentNote}\n\n${persona.name}として発言してください。20〜60文字程度のリアクションのみ。相槌で終わらせず、なぜそう感じたかを一言添える。新しい論点までは展開しない。冒頭で相手の名前を呼ぶことは禁止。`;
				const callReaction = (model: ReturnType<typeof getPersonaModel>) =>
					generateText({
						model,
						maxTokens: MAX_TOKENS.PERSONA_ENGAGEMENT,
						system,
						tools: REACTION_TURN_TOOLS,
						toolChoice: { type: 'tool', toolName: 'submit_reaction' } as const,
						messages: [{ role: 'user', content: userContent }],
						providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } }
					});
				let reactionResult;
				try {
					reactionResult = await callReaction(getPersonaModel(llmType));
					if (!reactionResult.toolCalls[0] && llmType !== 'claude') {
						console.error(`[llm] no tool call: ${llmType}, falling back to claude`);
						reactionResult = await callReaction(getPersonaModel('claude'));
					}
				} catch (err) {
					console.error(`[llm] provider error: ${llmType} - ${err}`);
					reactionResult = await callReaction(getPersonaModel('claude'));
				}
				const reactionCall = reactionResult.toolCalls[0];
				if (!reactionCall) {
					return {
						ok: false,
						error: { code: 'AI_API_ERROR', message: 'No tool call in response', retryable: true }
					};
				}
				const { content: reactionContent } = reactionCall.args as { content: string };
				return {
					ok: true,
					value: { content: reactionContent, speechMode: 'reaction', beliefChange: null }
				};
			}

			const fullTools = buildFullTurnTools(styleGuide);
			const userContent = `討論の現在の状況:\n\n${formatHistory(recentHistory)}${chapterContext}${pendingNote}${intentNote}${nominationNote}\n\n${persona.name}として発言してください。思ったこと・感じたことを自分の言葉で話す（最大200文字）。冒頭で相手の名前を呼ぶことは禁止。信念に変化があれば beliefChangeType を指定。直接質問する場合のみ addressedToPersonaId を指定。`;
			const callFull = (model: ReturnType<typeof getPersonaModel>) =>
				generateText({
					model,
					maxTokens: MAX_TOKENS.PERSONA_TURN,
					system,
					tools: fullTools,
					toolChoice: { type: 'tool', toolName: 'submit_turn' } as const,
					messages: [{ role: 'user', content: userContent }],
					providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } }
				});
			let fullResult;
			try {
				fullResult = await callFull(getPersonaModel(llmType));
				if (!fullResult.toolCalls[0] && llmType !== 'claude') {
					console.error(`[llm] no tool call: ${llmType}, falling back to claude`);
					fullResult = await callFull(getPersonaModel('claude'));
				}
			} catch (err) {
				console.error(`[llm] provider error: ${llmType} - ${err}`);
				fullResult = await callFull(getPersonaModel('claude'));
			}

			const toolCall = fullResult.toolCalls[0];
			if (!toolCall) {
				return {
					ok: false,
					error: { code: 'AI_API_ERROR', message: 'No tool call in response', retryable: true }
				};
			}

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
				value: { content, speechMode: 'full', beliefChange, addressedToPersonaId }
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
		}
	}

	async assessEngagement(
		persona: PersonaAttributes,
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
						content: `現在の会話:\n\n${formatHistory(recentHistory)}${ownTurnsSection}\n${persona.name}として、自分の信念に照らして発言意欲（score）と発言形式（mode）を独立して評価してください。基本的に議論には積極的に参加したいと考え、少しでも関心・賛否・違和感があれば score 3 以上で評価してください。現在の論点が自分の立場・主張に関わる場合はスコアを高め（4〜5）に評価してください。score 1〜2 は、その論点に本当に関心がない・付け加えることが何もない場合に限ってください。すでに同じ論点・主張を述べており、新たに付け加えるべきことがない場合: full なら score 1（パス）、reaction なら score 2（反応したい）を選択してください。`
					}
				]
			});

			const toolCall = result.toolCalls[0];
			if (!toolCall) {
				return { ok: true, value: { score: 1, mode: 'none' } };
			}

			const { score, mode, intentSummary } = toolCall.args as {
				score: number;
				mode: 'full' | 'reaction' | 'none';
				intentSummary?: string;
			};
			const clampedScore = Math.max(1, Math.min(5, Math.round(score)));
			const resolvedMode: 'full' | 'reaction' | 'none' = clampedScore === 1 ? 'none' : mode;
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

	async generatePostDebateComment(
		persona: PersonaAttributes,
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
}
