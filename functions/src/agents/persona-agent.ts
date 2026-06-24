import { generateText, generateObject, jsonSchema, Output, stepCountIs } from 'ai';
import { z } from 'zod';
import { getPersonaModel } from '../llm/models.js';
import { isSearchAvailable, executeSearch } from '../search/search-service.js';
import { formatTurns, currentDateString } from '../utils/prompt-formatters.js';
import type {
	PersonaReply,
	BeliefChangeEvent,
	PostDebateCommentResult,
	Engagement
} from '../types/debate.types.js';
import type { DebateTurn, TurnGenerationContext } from '../types/turn.types.js';
import type { Persona } from '../types/persona.types.js';
import type { Result, PipelineError } from '../types/common.types.js';

const latestBeliefContent = (persona: Persona): string => {
	const beliefs = persona.beliefs ?? [];
	if (beliefs.length === 0) return '';
	return beliefs.reduce((best, b) => (b.version > best.version ? b : best)).content;
};

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

const estimateExperienceLevel = (age: number, occupation: string): ExperienceLevel => {
	if (YOUNG_KEYWORDS.some((kw) => occupation.includes(kw)) || age <= 30) return 'young';
	if (VETERAN_KEYWORDS.some((kw) => occupation.includes(kw)) || age >= 55) return 'veteran';
	return 'mid';
};

const estimateAuthorityLevel = (stakeholderRole: string): AuthorityLevel => {
	if (HIGH_AUTHORITY_KEYWORDS.some((kw) => stakeholderRole.includes(kw))) return 'high';
	if (MID_AUTHORITY_KEYWORDS.some((kw) => stakeholderRole.includes(kw))) return 'mid';
	return 'general';
};

export const buildSpeechStyleGuide = (persona: Persona & { gender?: string }): string => {
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
};

const buildPersonaSystemPrompt = (
	persona: Persona & { gender?: string },
	interviewRecord: string,
	currentBelief: string
): string => {
	const styleGuide = buildSpeechStyleGuide(persona);
	return `あなたは以下のペルソナとして、異なる立場の人々が集まるテーマ対話の場に参加しています。あなたが発言するのは、相手の意見に同意したり補完したりするためではなく、自分の経験・立場・実感から言いたいことを伝えるためです。他の参加者の発言は、自分の考えや記憶を引き出すきっかけになることはありますが、その内容に引っ張られる必要はありません。正しいことを言う必要はなく、自分の生活や仕事から感じていることを率直に話してください。

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
};

// 発言意欲スコア（2〜5）に応じた発言の長さ。score 不明時（指名・キュー）は中くらい。
const speechLengthGuide = (score?: number): string => {
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
};

// OpenAI(gpt) の strict structured output は全プロパティを required に要求するため、
// optional ではなく nullable で「必須・null許容」にする。
const turnOutputSchema = z.object({
	content: z.string(),
	beliefChangeType: z.enum(['opinion_change', 'partial_acceptance']).nullable(),
	beliefChangeSummary: z.string().nullable(),
	beliefChangeUpdatedBelief: z.string().nullable(),
	targetPersonaId: z.string().nullable()
});

type TurnOutput = z.infer<typeof turnOutputSchema>;

type AnyTool = {
	description: string;
	inputSchema: ReturnType<typeof jsonSchema>;
	execute?: (input: { [key: string]: unknown }) => Promise<string>;
};

const buildFullTurnTools = (
	_styleGuide: string,
	_lengthGuide: string
): Record<string, AnyTool> | undefined => {
	if (!isSearchAvailable()) return undefined;

	return {
		web_search: {
			description:
				'数値・統計・最新情報など正確性が必要な情報を検索する。1〜2回以内で使用すること。',
			inputSchema: jsonSchema({
				type: 'object' as const,
				properties: { query: { type: 'string' as const, description: '検索クエリ（日本語可）' } },
				required: ['query']
			}),
			execute: async (args: { [key: string]: unknown }) => {
				const result = await executeSearch(args['query'] as string);
				return result.ok ? result.value : '検索結果を取得できませんでした。';
			}
		}
	};
};

export const generateTurn = async (
	persona: Persona,
	context: TurnGenerationContext,
	engagement: Engagement,
	personas: ReadonlyArray<Persona> = []
): Promise<Result<PersonaReply, PipelineError>> => {
	try {
		const { chapter, queuedTrigger, targetedBy } = context;
		const recentTurns = context.chapterTurns.slice(-20);
		const currentBelief = latestBeliefContent(persona);
		const styleGuide = buildSpeechStyleGuide(persona);
		const chapterContext = `\n\n【この章のフォーカス】「${chapter.title}」: ${chapter.focusQuestion}`;
		const queuedNote = queuedTrigger
			? `\n\n【持ち越しの言いたいこと】少し前に${queuedTrigger.speakerName}が「${queuedTrigger.content.slice(0, 80)}」と言ったのを聞いて、あなたはこれに何か言いたいと思っていました。会話の流れに沿って、適切であればこの話題に触れてください。`
			: '';
		const intentNote = engagement.intentSummary
			? `\n\n【今回伝えたいこと】${engagement.intentSummary}`
			: '';
		const facilitatorTargetNote =
			targetedBy === 'facilitator'
				? '\n\n【指名】ファシリテーターが直接あなたに話を向けました。この問いかけに対して、自分の立場・生活・仕事の経験から具体的に答えてください。'
				: '';

		const isFact = engagement.mode === 'fact';
		const isQuestion = engagement.mode === 'question';
		const system = buildPersonaSystemPrompt(persona, persona.interviewRecord ?? '', currentBelief);
		const llmType = persona.llmType ?? 'claude';

		const lastTurn = recentTurns[recentTurns.length - 1];
		const lastSpeakerName = lastTurn
			? lastTurn.personaId
				? (personas.find((p) => p.id === lastTurn.personaId)?.name ??
					`Persona(${lastTurn.personaId})`)
				: 'ファシリテーター'
			: undefined;
		const lastSpeakerNote = lastSpeakerName
			? `\n\n直前の発言は${lastSpeakerName}によるものです。${lastSpeakerName}に反応する場合は冒頭で名前を呼ばず、それより前の別の人の発言を取り上げるときだけ「さっき○○さんが言っていた〜」と名前を添えること。`
			: '';

		const lengthGuide = speechLengthGuide(engagement.score);
		const tools = buildFullTurnTools(styleGuide, lengthGuide);
		const otherPersonas = context.otherPersonas ?? [];
		const personaList =
			otherPersonas.length > 0
				? `\n【参加者一覧（targetPersonaId に使用するID）】\n${otherPersonas.map((p) => `- ${p.name}: ${p.id}`).join('\n')}`
				: '';
		const excludeNote = lastSpeakerName ? `（直前の発言者${lastSpeakerName}は除く）` : '';
		const targetingGuide = `まず自分が何を言いたいか・何を聞きたいかを決めてから、その内容に立場・職業・経験から最も関係しそうな参加者${excludeNote}がいれば targetPersonaId を指定する。特定の参加者と直接関係しない話であれば targetPersonaId は指定しない。${personaList}`;
		const opinionInstruction = `${persona.name}として発言してください。思ったこと・感じたことを自分の言葉で話す（${lengthGuide}）。信念に変化があれば beliefChangeType を指定。${targetingGuide}`;
		const factInstruction = `${persona.name}として、自分が知っている事実・データ・調査結果を相手に紹介してください（${lengthGuide}）。これは意見ではなく事実の共有です。自分の賛否・評価・主張は加えず、事実・データそのものを客観的に述べること（「私はこう思う」「〜すべきだ」は禁止）。皆が知っている前提にせず、「〜という調査があって」「〜って知ってますか？」のように、知らない相手に共有・説明するトーンで話す。検索ツールで確認した情報は根拠として使ってよい。確認していない情報は断言しない。${targetingGuide}`;
		const questionInstruction =
			isQuestion && engagement.intentSummary
				? `${persona.name}として、特定の参加者に直接質問してください（${lengthGuide}）。\n【今回の質問意図】${engagement.intentSummary}${personaList}\n必ず targetPersonaId に質問相手のIDを指定すること。信念変化があれば beliefChangeType を指定。`
				: '';
		const antiSycophancyNote = `\n【重要】発言の書き出しは、前の話者への同意・共感ではなく、自分が言いたいこと・引っかかっていること・疑問から始めること。前の話者の意見に同意であっても、自分の立場・経験から別の角度・ズレを持ち込む。`;
		const targetBiasNote =
			targetedBy === 'persona' && lastSpeakerName
				? `\n\n【注意】今回は${lastSpeakerName}にターゲットされての発言です。${lastSpeakerName}への再targetは直接確認・反論が必要な場合のみです。`
				: '';
		const instruction =
			(isQuestion && questionInstruction
				? questionInstruction
				: isFact
					? factInstruction
					: opinionInstruction) +
			antiSycophancyNote +
			targetBiasNote;
		const userContent = `討論の現在の状況:\n\n${formatTurns(recentTurns, personas)}${chapterContext}${lastSpeakerNote}${queuedNote}${intentNote}${facilitatorTargetNote}\n\n${instruction}`;
		const callFull = (model: ReturnType<typeof getPersonaModel>) =>
			generateText({
				model,
				system,
				output: Output.object({ schema: turnOutputSchema }),
				...(tools && { tools, stopWhen: stepCountIs(4) }),
				messages: [{ role: 'user', content: userContent }]
			});
		let fullResult;
		try {
			fullResult = await callFull(getPersonaModel(llmType));
			if (!fullResult.output?.content && llmType !== 'claude') {
				console.error(`[llm] no output content: ${llmType}, falling back to claude`);
				fullResult = await callFull(getPersonaModel('claude'));
			}
		} catch (err) {
			console.error(`[llm] provider error: ${llmType} - ${err}`);
			fullResult = await callFull(getPersonaModel('claude'));
		}

		if (!fullResult.output?.content) {
			return {
				ok: false,
				error: { code: 'AI_API_ERROR', message: 'No output content in response', retryable: true }
			};
		}

		const allToolCalls = fullResult.steps.flatMap((s: { toolCalls: unknown[] }) => s.toolCalls);
		const searchCalls = allToolCalls.filter(
			(c: unknown) => (c as { toolName: string }).toolName === 'web_search'
		);
		const searchQueries = searchCalls.map(
			(c: unknown) => (c as { input: { query: string } }).input.query
		);

		const {
			content,
			beliefChangeType,
			beliefChangeSummary,
			beliefChangeUpdatedBelief,
			targetPersonaId
		} = fullResult.output as TurnOutput;
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
				speechMode: isQuestion ? 'question' : isFact ? 'fact' : 'opinion',
				beliefChange,
				targetPersonaId: targetPersonaId ?? undefined,
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
};

const engagementSchema = z.object({
	score: z.number().int().min(1).max(5),
	mode: z.enum(['question', 'fact', 'opinion', 'none']),
	// gpt の strict structured output 対応のため optional ではなく nullable にする
	intentSummary: z.string().nullable()
});

export const evaluateEngagement = async (
	persona: Persona,
	turns: DebateTurn[],
	otherPersonaNames: string[] = [],
	personas: ReadonlyArray<Persona> = []
): Promise<Engagement> => {
	try {
		const recentTurns = turns.slice(-8);
		const ownTurns = turns.filter((t) => t.personaId === persona.id).slice(-5);
		const ownTurnsSection =
			ownTurns.length > 0
				? `\nあなた（${persona.name}）のこれまでの発言:\n${formatTurns(ownTurns, personas)}\n`
				: '';
		const otherPersonasNote =
			otherPersonaNames.length > 0 ? `\n他の参加者: ${otherPersonaNames.join('、')}` : '';
		const result = await generateObject({
			model: getPersonaModel(persona.llmType ?? 'claude'),
			system: buildPersonaSystemPrompt(
				persona,
				persona.interviewRecord ?? '',
				latestBeliefContent(persona)
			),
			schema: engagementSchema,
			messages: [
				{
					role: 'user',
					content: `現在の会話:\n\n${formatTurns(recentTurns, personas)}${ownTurnsSection}${otherPersonasNote}\n\n${persona.name}として、発言意欲（score）と発言形式（mode）を評価してください。\n\nまず上の会話を読んで、他の参加者の発言の中に「もっと聞きたい」「それは本当に？」「自分の経験では違う」「なぜそう思うのか確認したい」と感じるものがないか振り返ってください。そういう相手がいれば mode は question です（intentSummary に「誰の・どの発言について・何を聞きたいか」を書く）。\n\n次に、紹介すべき事実・データがあれば fact。それ以外は opinion。付け加えることがなければ score 1（none）。\n\nscore は mode ごとの基準で選んでください。\n\n【opinion / fact のスコア基準】\n- 1: 付け加えることがない\n- 2: 同意・補足程度（自分の角度はほぼない）\n- 3: 話したいことはあるが急かすほどでない\n- 4: 自分の立場・経験から別の角度を出せる\n- 5: 今すぐ言わないと議論が進まない\n\n【question のスコア基準】\n- 1: 特に聞きたいことはない\n- 2: なんとなく気になる程度\n- 3: 聞いてみたいが急かすほどでない\n- 4: 相手の発言や立場に引っかかりがあり、素直に聞いてみたい\n- 5: 今この人に確認しないと議論が進まない\n\n発言意欲は「このテーマが自分の生活・立場・実感にどれだけ関わるか」で決まります。すでに同じ主張を述べており新たに付け加えることがなければ score 1 を選んでください。\n\n重要：前の発言に「そうですね」と同意するだけで終わる発言しか浮かばないなら score を下げてください（同意を表明したいだけ → score 2 以下）。高い score は「自分にしかない別の角度・疑問・経験を加えたい」ときに使います。`
				}
			]
		});

		const { score, mode, intentSummary } = result.object;
		const clampedScore = Math.max(1, Math.min(5, Math.round(score)));
		let resolvedMode: 'opinion' | 'fact' | 'none' | 'question' = clampedScore === 1 ? 'none' : mode;
		if (resolvedMode === 'question' && !intentSummary) resolvedMode = 'opinion';
		const resolvedIntentSummary =
			resolvedMode === 'none' ? undefined : (intentSummary ?? undefined);
		return {
			personaId: persona.id,
			score: clampedScore,
			mode: resolvedMode,
			intentSummary: resolvedIntentSummary
		};
	} catch {
		return { personaId: persona.id, score: 1, mode: 'none' };
	}
};

const postDebateCommentSchema = z.object({
	content: z.string()
});

export const generatePostDebateComment = async (
	persona: Persona,
	finalBelief: string,
	turns: DebateTurn[],
	personas: ReadonlyArray<Persona> = []
): Promise<Result<PostDebateCommentResult, PipelineError>> => {
	try {
		const result = await generateObject({
			model: getPersonaModel(persona.llmType ?? 'claude'),
			system: buildPersonaSystemPrompt(persona, '', finalBelief),
			schema: postDebateCommentSchema,
			messages: [
				{
					role: 'user',
					content: `以下の討論全体を踏まえて、${persona.name}として討論後のコメントを2〜4文で述べてください。他の参加者の意見を聞いてどう感じたか、印象に残った意見、自分の考えの変化を含めてください。\n\n討論全体:\n${formatTurns(turns, personas)}`
				}
			]
		});

		return { ok: true, value: { personaId: persona.id, content: result.object.content } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};
