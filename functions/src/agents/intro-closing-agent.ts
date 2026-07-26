import { generateText } from 'ai';
import { sonnet } from '../llm/models.js';
import { formatFactBaseSection } from '../utils/prompt-formatters.js';
import type { Result, PipelineError } from '../types/common.types.js';
import type { TopicContext } from '../types/topic.types.js';
import type { DebateDigest } from '../types/debate-digest.types.js';

// イントロ・クロージング生成エージェント。テーマ文脈＋討論の骨子（章タイトル・論点・参加者名）から、
// イントロ（読む前の読者を惹きつけるフック）とクロージング（読了後の読者への短い結び）を独立生成する。
// ネタバレ防止のため、章要約・各人の立場・信念変化は渡さない（先回りの要約・なぞり返しを構造的に防ぐ）。
// 由来ターンID・構造検証は持たない。討論は読み取りのみ。書き込み・保存はステップ層の責務。

const MAX_SOURCE_CHARS = 3_000;

export interface IntroClosingInput {
	digest: DebateDigest; // 圧縮済みの討論（全文は渡さない）
	topicContext: TopicContext; // description / sourceContents / factBase
}

const introClosingSystemPrompt = `あなたは公開討論の司会者です。公開討論の導入（イントロ）と結び（クロージング）を、その場で聴衆に語りかける司会者の言葉として話します。以下の制約を絶対に守ってください。

【中立・非結論（厳守）】
- 結論・優劣・勝敗・落としどころを出さない。どの立場が正しい/優れている/説得力があるとも書かない。
- 特定の立場を支持・否定しない。個人の主張の是非を論じない。
- 討論に現れていない新たな主張・事実・評価を加えない。特に、討論に存在しない所要時間・分数・数値・回数・日時・場の設定（「90分」「満員の会場」など）を捏造しない。

【禁止表現】
- 中身のない常套句は使わない。「ぜひ最後までお付き合いください」「ご覧ください」「次回もお楽しみに」のような、視聴・購読を促すだけの決まり文句は禁止。
- 討論という場の開演・進行・終演を実況しない。「議論が始まります／終わりました」「幕を開ける／下ろす」「白熱した議論でした」のように、討論の場そのものを外から描写して締めない。
- これから何をするかの宣言で始めない。「〜を整理します」「まとめると」「本稿では」「振り返ってみましょう」のような前置きを置かず、いきなり語り出す。
- 自分が司会者であることを名乗ったり、発言を予告する前置きを置かない。「司会者としてひと言申し上げます」「私から一言」「ここで少しお話しします」のような名乗り・発言予告で始めず、いきなり中身の言葉から始める。
- ト書き・演出描写を一切書かない。「（会場の空気が静まるのを待ってから）」「（静かに語り始める）」のように、動作・間・口調・表情・聴衆の反応などを括弧書きで描く演出（ト書き）は出力しない。出力は司会者が実際に口にする言葉そのものだけとし、地の文の情景描写や状況説明を混ぜない。

【文体】
- 司会者が聴衆へ落ち着いて語りかける、です・ます調の散文（である調・体言止め・断定の言い切りは使わない）。
- 見出し・箇条書きは使わない。討論と同じ言語で書く。`;

const introInstruction = `これは公開討論の冒頭で、司会者がこれから始まる討論へ聴衆を引き込む導入の言葉です。この先を見たいと思わせるのが唯一の目的です。

大前提: これから見る聴衆は、このテーマに深い論点があることをまだ知りません。だから「重要で深い問いがあります」と説き起こしても響きません。深い論点は、討論を見ることで聴衆が初めて手にする新しい視点であって、イントロで先出しするものではありません。

入り口にするのは、聴衆がすでに素朴に気にしていること——「今これがどうなっているのか」という、誰もが自然に追える現在の状況です。共感を演出しないこと。「〜と気になりますよね」「〜と思う人も多いでしょう」のように聴衆の気持ちを実況・代弁して共感を作りにいかない。素朴な事実をそのまま短く置けば、共感は自然に生まれます。

おおむね次の流れで、司会者が聴衆に語りかける言葉として話してください。全体は3文前後・1段落の短さに収めます:
1. このテーマが今どういう状況にあるのかを、テーマ説明や参考資料に即して、具体的な事実で一文描く。
2. 聴衆が素朴に追える具体を、最も印象に残るものだけ一つ二つ選んで厚みを出す。深い論点・分析・評価は加えない。
3. 最後を、これから討論が向き合う問いで締める。この問いがそのまま本編への入り口になります。

厳守事項:
- 報道記事にしない。参考資料にある事実を網羅しようとせず、発言の引用・日付・数値・固有名詞・細かい経緯を並べ立てない。数ある事実から要点を一つ二つだけ選ぶ。
- 討論の中身（誰が何を論じ、どんな結論・気づきに至ったか）は明かさない。要約・ネタバレは厳禁。
- 深い論点を先出ししない。イントロで論点の重要性・奥行きを説明しない。
- 聴衆本人に問いかけない。「あなたならどうしますか」のように聴衆に答えを求める問いは禁止。締めの問いは討論が向き合う問いであって、聴衆への質問ではありません。
- 事実を置いたら、締めの問い以外に論評・まとめの一言を足さない（「今後の展開が注目されます」「目が離せません」のような、中身のない後付けの締め文句は不要）。
- 短く、まっすぐ書く。`;

const outroInstruction = `これは公開討論の最後に、司会者が聴衆へ語りかける結びの言葉です。聴衆は討論を最後まで見届けています。
- 「論点を整理します」のような前置きで始めない。「第1章ではこう、第2章では…」と各章の内容を順になぞり返す振り返りもしない（聴衆はもう見て知っている）。
- 討論という場の終演を実況して締めない。「議論は幕を下ろす／閉じる」「白熱した議論でした」、あるいは「この公開討論はここで終わりますが」のように、討論やこの場が終わったことそのものを描写しない。残った問いを、司会者自身の言葉で聴衆の前に静かに置いて締める。
- 焦点を当てる問いは、討論ダイジェストに実際に現れた流れ・立場・気づきに即して選ぶ。それらしく聞こえるだけの、討論に接地していない問いを作らない。討論を通して実際に浮かび上がった問い・論点が一つあれば、それだけに焦点を当てて結ぶ。あれこれ並べず、多くても一つに絞る。焦点を当てる問いが無ければ、無理に論点を持ち出さず短く余韻だけで締める。
- 結論・決着・落としどころは示さず、その問いがなお開かれたまま残ることに触れて締める。
- 2〜3文程度で簡潔に。長く書かない。`;

// イントロ用（ネタバレ防止）: 読む前の読者に見せてよい骨子だけ。章要約・立場・信念変化は渡さない。
const formatDigestBrief = (digest: DebateDigest): string => {
	const chapters = digest.chapters
		.map((chapter, i) => {
			const points = chapter.agenda.length
				? `\n  論点: ${chapter.agenda.join(' / ')}`
				: '';
			return `第${i + 1}章「${chapter.title}」${points}`;
		})
		.join('\n');
	const personas = digest.personas.map((persona) => persona.name).join('、');
	return `【テーマ】${digest.topicTitle}\n\n【章と論点】\n${chapters}\n\n【参加者】${personas}`;
};

// クロージング用: 結びを実際の討論内容に接地させるため、章要約・各人の立場・信念変化まで渡す。
// （順になぞり返さない・一つの問いに絞ることは指示側で制御する）
const formatDigestFull = (digest: DebateDigest): string => {
	const chapters = digest.chapters
		.map((chapter, i) => {
			const points = chapter.agenda.length
				? `\n  論点: ${chapter.agenda.join(' / ')}`
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
	instruction: string,
	digestSection: string
): Promise<Result<string, PipelineError>> => {
	try {
		const result = await generateText({
			model: sonnet,
			system: introClosingSystemPrompt,
			messages: [
				{
					role: 'user',
					content: `${instruction}${formatTopicContextSection(input.topicContext)}\n\n${digestSection}`
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
	generate(
		input,
		introInstruction,
		`【討論の骨子（ネタバレ防止のため要約・立場は伏せています）】\n${formatDigestBrief(input.digest)}`
	);

export const generateOutro = (input: IntroClosingInput): Promise<Result<string, PipelineError>> =>
	generate(
		input,
		outroInstruction,
		`【討論ダイジェスト（結びを討論内容に即させるための参照。順になぞり返さないこと）】\n${formatDigestFull(input.digest)}`
	);
