import { generateText, generateObject, jsonSchema, Output, stepCountIs } from 'ai';
import type { SystemModelMessage } from 'ai';
import { z } from 'zod';
import { sonnet } from '../llm/models.js';
import { isSearchAvailable, executeSearch } from '../search/search-service.js';
import {
	formatTurns,
	currentDateString,
	formatFactBaseSection,
	formatAwarenessSection
} from '../utils/prompt-formatters.js';
import { getBelief } from '../pipeline/debate/awareness.js';
import type { PersonaReply, ImpressionResult, Engagement } from '../types/debate.types.js';
import type { DebateTurn, TurnGenerationContext } from '../types/turn.types.js';
import type { Persona } from '../types/persona.types.js';
import { FACILITATOR_NAME } from '../constants/debate.constants.js';
import type { Result, PipelineError } from '../types/common.types.js';

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
	const authLevel = estimateAuthorityLevel(persona.role);
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
	belief: string
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
- **「刺さる」と言いたくなったら、別の言い方に置き換える**。共感・納得・心を動かされた感覚は、「なるほど」「そうなんだ」「わかる気がする」「それは確かに」「そこは考えさせられる」など、普通の日本人が日常会話で自然に使う素朴な言葉で表すこと。
- **「正直」「正直に言うと」を多用しない**。本音を述べる前置きとして毎回付けるのは不自然。前置きなしで率直に話せばよい。
- **毎回、自分の職業・専門分野に話を引き寄せない**。テーマは基本的に一人の生活者・市民として受け止め、素朴な生活実感や一般的な感覚から話す。自分の仕事・専門の経験を持ち出すのは、それがそのテーマに本当に自然に結びつくとき（せいぜい時々）に限る。「〜の現場でも」「〜の仕事でも同じで」のように、毎回のように自分のフィールドの例えへ落とし込むのは不自然。テーマと職業の関係が薄いときは、無理に職業に絡めず、職業に触れずに話してよい。

## ペルソナプロフィール
- 名前: ${persona.name}
- 年齢: ${persona.age}歳
- 職業: ${persona.occupation}
- 立場: ${persona.role}
- 背景: ${persona.background}
- 関心事: ${persona.interests}

## 事前取材レコード
（討論の前に、あなたが記者から個別に受けた取材の記録。この場で話された内容ではなく、他の参加者は誰もこの内容を知りません。あなた自身の経験・記憶としてだけ持っているものなので、ここで話した話題を既出のものとして持ち出さず、必要なら討論の場で一から話すこと）
${interviewRecord}

## 信念ドキュメント（不変の主軸）
（討論を通じて変わらない、あなたの立場の主軸。内面の一貫性を保つための参照資料であり、発言で直接引用・言及しないこと）
${belief}

## 情報収集について
数値・統計・最新動向など正確性が求められる情報を発言の根拠として示す場合は、推測や記憶だけに頼らず検索ツールを積極的に使用すること。
検索クエリは自分の立場・職業・関心に沿った視点で構築すること。
検索ツールは必要なときのみ使用し、1〜2回以内にとどめること。
自分の体験・実感はそのまま語ってよい。`;
};

const PERSONA_CACHE_PROVIDER_OPTIONS: SystemModelMessage['providerOptions'] = {
	anthropic: { cacheControl: { type: 'ephemeral' } }
};

// ペルソナの安定コンテキスト（不変の system）を cacheControl 付き system メッセージにして、
// 同一ペルソナの複数呼び出しでプロンプトキャッシュを再利用させる。
// キャッシュは出力を変えないため、発言・engagement の内容・スキーマは不変。
const buildPersonaSystem = (system: string): SystemModelMessage => ({
	role: 'system',
	content: system,
	providerOptions: PERSONA_CACHE_PROVIDER_OPTIONS
});

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
		const { chapter, queuedTrigger, targetedBy, activeAgendaItem } = context;
		const recentTurns = context.chapterTurns.slice(-20);
		const belief = getBelief(persona);
		const styleGuide = buildSpeechStyleGuide(persona);
		// 発言者の文脈はアクティブ論点に一本化する。論点が無ければ章タイトルを場のテーマとして提示する（focusQuestion は使わない）
		const chapterFocusNote = activeAgendaItem
			? `\n\n【いま向き合う論点】${activeAgendaItem}\nファシリテーターがこの論点を場に出しています。これを意識し、自分の立場・経験から具体的に語ること（無理に同意せず、自分の角度で）。`
			: `\n\n【この章のテーマ】${chapter.title}\nいまはこのテーマについて話しています。自分の立場・経験から具体的に語ること。`;
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
		const system = buildPersonaSystemPrompt(persona, persona.interviewRecord ?? '', belief);

		const lastTurn = recentTurns[recentTurns.length - 1];
		const lastSpeakerName = lastTurn
			? lastTurn.personaId
				? (personas.find((persona) => persona.id === lastTurn.personaId)?.name ??
					`Persona(${lastTurn.personaId})`)
				: FACILITATOR_NAME
			: undefined;
		const lastSpeakerNote = lastSpeakerName
			? `\n\n直前の発言は${lastSpeakerName}によるものです。${lastSpeakerName}に反応する場合は冒頭で名前を呼ばず、それより前の別の人の発言を取り上げるときだけ「さっき○○さんが言っていた〜」と名前を添えること。`
			: '';

		const lengthGuide = speechLengthGuide(engagement.score);
		const tools = buildFullTurnTools(styleGuide, lengthGuide);
		const otherPersonas = context.otherPersonas ?? [];
		const personaList =
			otherPersonas.length > 0
				? `\n【参加者一覧（targetPersonaId に使用するID）】\n${otherPersonas.map((persona) => `- ${persona.name}: ${persona.id}`).join('\n')}`
				: '';
		const excludeNote = lastSpeakerName ? `（直前の発言者${lastSpeakerName}は除く）` : '';
		const targetingGuide = `まず自分が何を言いたいか・何を聞きたいかを決める。指名（targetPersonaId の指定）は、特定の相手の発言に直接反論・確認する明確な必要があるときだけにとどめ、それ以外は場全体への発言として targetPersonaId を指定しない（既定は未指定）。指定する場合のみ、その内容に立場・職業・経験から最も関係する参加者${excludeNote}を選ぶ。${personaList}`;
		const opinionInstruction = `${persona.name}として発言してください。思ったこと・感じたことを自分の言葉で話す（${lengthGuide}）。${targetingGuide}`;
		const factInstruction = `${persona.name}として、自分が知っている事実・データ・調査結果を相手に紹介してください（${lengthGuide}）。これは意見ではなく事実の共有です。自分の賛否・評価・主張は加えず、事実・データそのものを客観的に述べること（「私はこう思う」「〜すべきだ」は禁止）。皆が知っている前提にせず、「〜という調査があって」「〜って知ってますか？」のように、知らない相手に共有・説明するトーンで話す。検索ツールで確認した情報は根拠として使ってよい。確認していない情報は断言しない。${targetingGuide}`;
		const questionInstruction =
			isQuestion && engagement.intentSummary
				? `${persona.name}として、特定の参加者に直接質問してください（${lengthGuide}）。\n【今回の質問意図】${engagement.intentSummary}${personaList}\n質問の書き出しは「気になるのは」「気になったのは」「そこが気になる」のような定型句で始めないこと。相手の発言の具体的な部分を引いて問う、自分の経験・立場を一言置いてから問う、結論を先に言ってから問う、など書き出しを毎回変えること。\n必ず targetPersonaId に質問相手のIDを指定すること。`
				: '';
		const antiSycophancyNote = `\n【重要】発言の書き出しは、前の話者への同意・共感ではなく、自分が言いたいこと・引っかかっていること・疑問から始めること。前の話者の意見に同意であっても、自分の立場・経験から別の角度・ズレを持ち込む。`;
		const targetBiasNote =
			targetedBy === 'persona' && lastSpeakerName
				? `\n\n【注意】今回は${lastSpeakerName}にターゲットされての発言です。ここで${lastSpeakerName}へ再び targetPersonaId を指定すると、同じ二人の往復が続いて議論が固定化します。直接の確認・反論がどうしても必要な場合を除き、再 target せず場全体に向けて話してください。`
				: '';
		const instruction =
			(isQuestion && questionInstruction
				? questionInstruction
				: isFact
					? factInstruction
					: opinionInstruction) +
			antiSycophancyNote +
			targetBiasNote;
		// 事実基盤（共通前提）。件数ノルマを課さず、暗唱・羅列を避け、自分の立場からの反応にする（R8.2〜8.5）。
		// 層②優先を別ブロックにせず、この共有事実注記そのものに内在させる（衝突点限定・R8.8/8.9）。
		const factSection = formatFactBaseSection(context.factBase);
		const factBaseNote = factSection
			? `${factSection}\n【事実への関与】上記はこのテーマの共通の背景であり、基本は共通前提として踏まえます。全てに触れる必要はなく、言及の件数ノルマもありません。自分のプロフィール・関心度に応じて自然に関与し、暗唱・羅列ではなく自分の立場・経験からの反応として述べてください。関心が薄いテーマなら詳細に立ち入らず概括的に反応してよい（知ったかぶりはしない）。ただし、自分の認識（信念・立場から見た事実）と食い違う点に限っては、自分の見方を優先し、共有側の記述を自分の立場から再解釈して構いません（これはあなた自身の発言の中での解釈であり、共有前提すべてを否認するものではありません）。`
			: '';
		// 事実確認の指摘フィードバック（補正再生成）。未指定なら従来どおりの生成（3.1〜3.4）
		const factCheckFeedback = context.factCheckFeedback ?? [];
		const factCheckNote =
			factCheckFeedback.length > 0
				? `\n\n【事実確認による修正指示】直前に生成したあなたの発言ドラフトに、以下の事実誤認の指摘がありました。指摘を踏まえ、誤りを含まない発言に作り直してください。\n${factCheckFeedback
						.map((feedback, index) =>
							feedback.verdict === 'incorrect'
								? `${index + 1}. 「${feedback.claim}」は誤り。正しくは: ${feedback.correction}（理由: ${feedback.reason}）`
								: `${index + 1}. 「${feedback.claim}」は裏付けが取れず検証不能（理由: ${feedback.reason}）`
						)
						.join(
							'\n'
						)}\n【修正の方針】\n- 自分の立場・口調・論旨の方向性・指名（targetPersonaId）の整合は維持する（ただし事実の訂正によって主張の結論が変わることは許容する）\n- 誤り（incorrect）の主張は発言に含めず、訂正後の事実に基づいて組み立て直す\n- 検証不能（unverifiable）の主張は、不確実性を含む表現に改めるか取り下げる`
				: '';
		// 蓄積された気づきを発言の入力として反映（消費）。発言段階では新規検出せず、
		// 信念を主軸に立場を反転させない範囲で踏まえる（整形側に非反転の指針を内在）
		const awarenessNote = formatAwarenessSection(persona.awarenesses);
		const userContent = `討論の現在の状況:\n\n${formatTurns(recentTurns, personas)}${chapterFocusNote}${factBaseNote}${awarenessNote}${lastSpeakerNote}${queuedNote}${intentNote}${facilitatorTargetNote}\n\n${instruction}${factCheckNote}`;
		const fullResult = await generateText({
			model: sonnet,
			system: buildPersonaSystem(system),
			output: Output.object({ schema: turnOutputSchema }),
			...(tools && { tools, stopWhen: stepCountIs(4) }),
			messages: [{ role: 'user', content: userContent }]
		});

		if (!fullResult.output?.content) {
			return {
				ok: false,
				error: { code: 'AI_API_ERROR', message: 'No output content in response', retryable: true }
			};
		}

		const allToolCalls = fullResult.steps.flatMap(
			(step: { toolCalls: unknown[] }) => step.toolCalls
		);
		const searchCalls = allToolCalls.filter(
			(toolCall: unknown) => (toolCall as { toolName: string }).toolName === 'web_search'
		);
		const searchQueries = searchCalls.map(
			(toolCall: unknown) => (toolCall as { input: { query: string } }).input.query
		);

		const { content, targetPersonaId } = fullResult.output as TurnOutput;
		return {
			ok: true,
			value: {
				content,
				speechMode: isQuestion ? 'question' : isFact ? 'fact' : 'opinion',
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
	intentSummary: z.string().nullable(),
	// 傾聴段階で検出する気づき（大半は null）。ネストも gpt strict 対応で全項目 nullable 必須。
	// sourceTurnId は reception が反応した発言のローカル序数（会話提示の各行頭 [N]）。話者は突合後にコードで導出する
	awareness: z
		.object({
			kind: z.enum(['reception', 'self']),
			content: z.string(),
			sourceTurnId: z.string().nullable()
		})
		.nullable()
});

export const evaluateEngagement = async (
	persona: Persona,
	turns: DebateTurn[],
	otherPersonaNames: string[] = [],
	personas: ReadonlyArray<Persona> = [],
	activeAgendaItem = ''
): Promise<Engagement> => {
	try {
		const recentTurns = turns.slice(-8);
		// 傾聴側の会話提示にだけ発言単位のローカル序数（[N]）を付す。末尾＝直前の発言＝気づきの発生源。
		// 発話生成と共有する formatTurns は変更せず、ここで各発言に番号を前置し、序数→発言の対応はコードで解決する。
		const numberedConversation =
			recentTurns.length > 0
				? recentTurns
						.map((turn, index) => `[${index + 1}] ${formatTurns([turn], personas)}`)
						.join('\n')
				: formatTurns(recentTurns, personas);
		const ownTurns = turns.filter((turn) => turn.personaId === persona.id).slice(-5);
		const ownTurnsSection =
			ownTurns.length > 0
				? `\nあなた（${persona.name}）のこれまでの発言:\n${formatTurns(ownTurns, personas)}\n`
				: '';
		const otherPersonasNote =
			otherPersonaNames.length > 0 ? `\n他の参加者: ${otherPersonaNames.join('、')}` : '';
		// 既存の気づきを傾聴の入力（文脈）としても読む（聞く→気づく→話すの連続性）
		const awarenessSection = formatAwarenessSection(persona.awarenesses);
		// いま場に出ている論点。発言意欲・意図はこの論点に対して付け加えられることを基準に決める（他者への迎合抑制とは別軸）。
		const agendaAnchor = activeAgendaItem
			? `\n\n【いま場で話されている論点】${activeAgendaItem}\nいま参加者はこの論点について話しています。あなたの発言意欲（score）と発言意図（intentSummary）は、この論点に対して自分が付け加えられること（別の角度・経験・疑問・事実）があるかで決めてください。論点と関係の薄い、自分がただ言いたいだけの話には高い score を付けないこと。question / opinion の intentSummary は「この論点について何を言いたいか／誰にどの発言のどこを聞きたいか」で書くこと。`
			: '';
		// score/mode の主判定とは分節した、付随的な気づき検出タスク（低干渉・厳格な閾値・簡潔にしてコスト抑制）
		const awarenessDetectionNote = `\n\n---\n【気づき検出】score/mode の評価とは別に行い、この検出は score/mode の判定を変えない。気づきの発生源は提示会話の最後の1発言（末尾＝直前の発言）のみ。それ以前の発言は直前発言を理解するための文脈であり、発生源にはしない。\n【awareness の出力】awareness は、直前発言によってあなたの結論・立場そのものが以前と別の場所に動いたとき（これまで退けていた点を受け入れた／自分の主張を取り下げ・限定した／立場を変える新しい論点を採り入れた等）だけ、オブジェクトとして出力する。それ以外はすべて null（ほとんどのターンは null）。自己点検：content が「改めて〜」「やはり〜」「再確認した」「深く理解した／腹落ちした」で自然に書けるものは、結論が動いておらず再認識なので null。\n【出力する場合の形式】content は一文。文体は常体（「〜した。」「〜だ。」調）で書き、敬体（です・ます調）は混ぜない。reception=直前発言（他者）で気づいた／self=直前発言を聞いて自分の中で新たに生じた。reception のとき sourceTurnId に反応した発言の番号（各行頭の [N]。通常は末尾＝直前発言）を記す。self は sourceTurnId を null にしてよい。`;
		const system = buildPersonaSystemPrompt(
			persona,
			persona.interviewRecord ?? '',
			getBelief(persona)
		);
		const result = await generateObject({
			model: sonnet,
			system: buildPersonaSystem(system),
			schema: engagementSchema,
			messages: [
				{
					role: 'user',
					content: `現在の会話（各行頭の [N] は発言の番号。末尾が直前の発言）:\n\n${numberedConversation}${ownTurnsSection}${otherPersonasNote}${awarenessSection}${agendaAnchor}\n\n${persona.name}として、発言意欲（score）と発言形式（mode）を評価してください。\n\nまず上の会話を読んで、いまの論点について、他の参加者の発言の中に「もっと聞きたい」「それは本当に？」「自分の経験では違う」「なぜそう思うのか確認したい」と感じるものがないか振り返ってください。そういう相手がいれば mode は question です（intentSummary に「誰の・どの発言について・何を聞きたいか」を書く）。\n\n次に、いまの論点について紹介すべき事実・データがあれば fact。それ以外は opinion。付け加えることがなければ score 1（none）。\n\nscore は mode ごとの基準で選んでください。\n\n【opinion / fact のスコア基準】\n- 1: 付け加えることがない\n- 2: 同意・補足程度（自分の角度はほぼない）\n- 3: 話したいことはあるが急かすほどでない\n- 4: 自分の立場・経験から別の角度を出せる\n- 5: 今すぐ言わないと議論が進まない\n\n【question のスコア基準】\n- 1: 特に聞きたいことはない\n- 2: 少し引っかかる程度\n- 3: 聞いてみたいが急かすほどでない\n- 4: 相手の発言や立場に引っかかりがあり、素直に聞いてみたい\n- 5: 今この人に確認しないと議論が進まない\n\n発言意欲は「いまの論点が自分の生活・立場・実感にどれだけ関わるか」と「その論点に自分が付け加えられることがあるか」で決まります。いまの論点と関係が薄い、または自分の言いたいこと（信念そのものの繰り返し）を論点と無関係に述べたいだけなら score を下げてください。すでに同じ主張を述べており新たに付け加えることがなければ score 1 を選んでください。\n\n重要：前の発言に「そうですね」と同意するだけで終わる発言しか浮かばないなら score を下げてください（同意を表明したいだけ → score 2 以下）。高い score は「いまの論点に対して、自分にしかない別の角度・疑問・経験を加えたい」ときに使います。${awarenessDetectionNote}`
				}
			]
		});

		const { score, mode, intentSummary, awareness } = result.object;
		const clampedScore = Math.max(1, Math.min(5, Math.round(score)));
		let resolvedMode: 'opinion' | 'fact' | 'none' | 'question' = clampedScore === 1 ? 'none' : mode;
		if (resolvedMode === 'question' && !intentSummary) resolvedMode = 'opinion';
		const resolvedIntentSummary =
			resolvedMode === 'none' ? undefined : (intentSummary ?? undefined);
		// 気づきの発生源は直前発言（提示ウィンドウの末尾）のみ。
		const lastTurn = recentTurns[recentTurns.length - 1];
		// Req2.1 リスナー限定ガード：直前発言の話者が評価対象自身なら気づきを発生させない
		const lastSpeakerIsSelf = !!lastTurn && lastTurn.personaId === persona.id;
		// reception が申告した序数（sourceTurnId）が直前発言（末尾）を指すときだけ true（発言粒度で突合）
		const sourceIsLastTurn = (sourceTurnId: string | null): boolean =>
			!!sourceTurnId && Number(sourceTurnId) === recentTurns.length;
		// 気づきは score/mode と独立（非話者・score 1 でも保持）。content 空は無しとみなす。
		// reception は sourceTurnId が直前発言と一致するときのみ採用し、話者を直前発言から導出する。
		// 不一致（直前より前・同一話者の過去発言を含む）は drop（null）。self は sourcePersonaId=null で維持する。
		const resolvedAwareness = (() => {
			if (!awareness || !awareness.content.trim() || lastSpeakerIsSelf) return null;
			if (awareness.kind === 'self') {
				return { kind: 'self' as const, content: awareness.content, sourcePersonaId: null };
			}
			if (!sourceIsLastTurn(awareness.sourceTurnId)) return null;
			return {
				kind: 'reception' as const,
				content: awareness.content,
				sourcePersonaId: lastTurn?.personaId ?? null
			};
		})();
		return {
			personaId: persona.id,
			score: clampedScore,
			mode: resolvedMode,
			intentSummary: resolvedIntentSummary,
			awareness: resolvedAwareness
		};
	} catch {
		return { personaId: persona.id, score: 1, mode: 'none' };
	}
};

const impressionSchema = z.object({
	content: z.string()
});

export const generateImpression = async (
	persona: Persona,
	turns: DebateTurn[],
	personas: ReadonlyArray<Persona> = []
): Promise<Result<ImpressionResult, PipelineError>> => {
	try {
		// 見解は「固定の信念（主軸・system）＋討論で得た気づき（揮発部）」から都度導出する（4.1/4.3）。
		// プロンプトは「討論全文 → 気づきリスト → 指示」の順にし、生成直前（末尾）に来るのを最終発言ではなく
		// 本人の気づき＋指示にする。これで末尾発言への引っ張られ（リセンシー）を気づき側へ向け直す。
		const awarenessLines = (persona.awarenesses ?? [])
			.map(
				(awareness) =>
					`- （${awareness.kind === 'reception' ? '受容' : '自分の気づき'}）${awareness.content}`
			)
			.join('\n');
		const hasAwareness = awarenessLines.length > 0;

		const transcriptSection = `討論全文:\n${formatTurns(turns, personas)}`;
		const awarenessSection = hasAwareness
			? `\n\nあなたが討論中に得た気づき（他者の意見に「一理ある」と受け止めた点や、自分の中で生じた気づき）:\n${awarenessLines}`
			: '';
		const instruction = hasAwareness
			? `\n\n上の討論を踏まえつつ、${persona.name}として討論後のコメントを2〜4文で述べてください。討論の特定の発言、とりわけ最後の発言に反応するのではなく、上に挙げた「あなた自身の気づき」を軸に、自分の考えがどう動いたか・何が印象に残ったかを自分の言葉で述べること（討論全文は、その気づきを具体的に思い出すための材料として使ってよい）。「今日の話を聞いていて」「討論を通じて」「今回の議論で」のような振り返りの前置き・実況で始めないこと。前置きは付けず、いきなり感じたこと・考えの変化そのものから書き出す。`
			: `\n\n上の討論を踏まえて、${persona.name}として討論後のコメントを2〜4文で述べてください。他の参加者の意見を聞いてどう感じたか、印象に残った意見、自分の考えの変化を含めてください。特定の発言、とりわけ最後の発言だけに反応せず、討論全体の中で実際に自分の考えに影響した点を選ぶこと。「今日の話を聞いていて」「討論を通じて」「今回の議論で」のような振り返りの前置き・実況で始めないこと。前置きは付けず、いきなり感じたこと・考えの変化そのものから書き出す。`;

		// 文体の統一（重要）。討論での話し方と同じ口語の語り口に固定し、参照する気づきメモ（常体で記録）に
		// 引きずられて「だ・である調」が混ざるのを防ぐ。
		const styleNote = `\n\n【文体の統一】討論での${persona.name}自身の話し方と同じ口語の語り口で、最初から最後まで文体を統一して書くこと。「〜だ」「〜である」調・体言止め・断定の言い切りといった書き言葉を混ぜず、語り口を崩さない（参照する気づきメモが常体で書かれていても、その文体には引きずられない）。`;

		const result = await generateObject({
			model: sonnet,
			system: buildPersonaSystemPrompt(persona, '', getBelief(persona)),
			schema: impressionSchema,
			messages: [
				{
					role: 'user',
					content: `${transcriptSection}${awarenessSection}${instruction}${styleNote}`
				}
			]
		});

		return { ok: true, value: { personaId: persona.id, content: result.object.content } };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};
