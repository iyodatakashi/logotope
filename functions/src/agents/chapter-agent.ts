import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { AI_MODELS } from '../constants/ai.constants.js';
import { formatPersonas, formatFactBaseSection } from '../utils/prompt-formatters.js';
import { buildNeutralitySystemPrompt } from './facilitator-agent.js';
import type { Chapter, Issue, IssueGroup } from '../types/chapter.types.js';
import type { Persona } from '../types/persona.types.js';
import type { Result, PipelineError } from '../types/common.types.js';
import type { TopicContext } from '../types/topic.types.js';

const buildTopicContextSection = (topicContext?: TopicContext): string => {
	if (!topicContext) return '';
	const parts: string[] = [];
	if (topicContext.description) {
		parts.push(
			`\n\n【テーマの方向性（最優先）】\n以下はこのテーマで設定者が意図した方向性・重視する観点です。論点・章立ては必ずこの方向性に沿って生成し、方向性から外れた切り口は避けてください。\n${topicContext.description}`
		);
	}
	if (topicContext.sourceContents?.length) {
		const sources = topicContext.sourceContents
			.map((sourceContent, i) => `--- 参考資料 ${i + 1} ---\n${sourceContent}`)
			.join('\n\n');
		parts.push(`\n\n【参考資料】\n${sources}`);
	}
	parts.push(formatFactBaseSection(topicContext.factBase));
	return parts.join('');
};

const SCORE_THRESHOLD = 7;

const CHAPTER_GENERATION_GOAL = `【ゴール】
これは討論コンテンツの章立てを作る作業です。目指すのは「章ごとに主題が明確で、読みやすい討論コンテンツ」。各章は1つの主題に絞られ、視聴者がその主題を見失わずに読み進められる状態を目標とします。主題がぼやける細切れの章や、章をまたいだ同じ話の繰り返しは読みやすさを損なうため避けます。`;

const scoringResultSchema = z.object({
	scoredIssues: z.array(
		z.object({
			index: z.number().int(),
			score: z.number().int().min(0).max(10),
			reason: z.string()
		})
	)
});

const dedupeResultSchema = z.object({
	duplicateGroups: z.array(
		z.object({
			indexes: z.array(z.number().int())
		})
	)
});

const groupingResultSchema = z.object({
	issueGroups: z.array(
		z.object({
			issueIndexes: z.array(z.number().int()),
			issues: z.array(z.string()).optional()
		})
	)
});

const chapterResultSchema = z.object({
	chapters: z.array(
		z.object({
			title: z.string(),
			agenda: z.array(z.string())
		})
	)
});

const issuesSchema = z.object({
	issues: z.array(z.string())
});

const scoreIssues = async (
	topicTitle: string,
	issues: Issue[],
	topicContext?: TopicContext
): Promise<Issue[]> => {
	const result = await generateObject({
		model: anthropic(AI_MODELS.SONNET),
		system: buildNeutralitySystemPrompt(),
		schema: scoringResultSchema,
		messages: [
			{
				role: 'user',
				content: buildScoringPrompt(topicTitle, issues, topicContext)
			}
		]
	});
	return issues.map((issue, i) => {
		const scored = result.object.scoredIssues.find((scoredIssue) => scoredIssue.index === i);
		return {
			...issue,
			score: scored?.score ?? 0,
			reason: scored?.reason ?? ''
		};
	});
};

const buildScoringPrompt = (
	topicTitle: string,
	issues: Issue[],
	topicContext?: TopicContext
): string => {
	const contextSection = buildTopicContextSection(topicContext);
	const issueList = issues.map((issue, i) => `${i}. [${issue.source}] ${issue.text}`).join('\n');
	return `テーマ「${topicTitle}」について、以下の論点をすべて相対評価し、各論点に0〜10のスコアと採点理由を付与してください。

【論点一覧（index: 論点テキスト）】
${issueList}

【評価軸】
- 様々な立場から多様な意見が出うる論点か（一つの見方に閉じていないか）
- 専門知識のない一般人が関心を持てるか
※「対立が激しい」「激突する」「勝敗がつく」ことを価値の基準にしない。複数の立場が筋道立てて成立しうるかで評価し、採点理由もその観点で書くこと。

【スコア分布の制約】
- 全論点を高得点にしないこと
- 必ず低スコア（5以下）の論点を含めること（全論点が高品質な場合を除く）
- 論点同士を比較した相対評価でスコアを決定すること

各論点の index（0始まり）、score（0〜10の整数）、reason（採点理由）を返してください。${contextSection}`;
};

const dedupeIssues = async (
	topicTitle: string,
	issues: Issue[],
	topicContext?: TopicContext
): Promise<Issue[]> => {
	const result = await generateObject({
		model: anthropic(AI_MODELS.SONNET),
		system: buildNeutralitySystemPrompt(),
		schema: dedupeResultSchema,
		messages: [
			{
				role: 'user',
				content: buildDedupePrompt(topicTitle, issues, topicContext)
			}
		]
	});

	const removed = new Set<number>();
	for (const group of result.object.duplicateGroups) {
		const valid = group.indexes.filter((index) => index >= 0 && index < issues.length);
		if (valid.length <= 1) continue;
		const keeper = valid.reduce((best, index) =>
			(issues[index].score ?? 0) > (issues[best].score ?? 0) ? index : best
		);
		for (const index of valid) {
			if (index !== keeper) removed.add(index);
		}
	}

	return issues.filter((_, index) => !removed.has(index));
};

const buildDedupePrompt = (
	topicTitle: string,
	issues: Issue[],
	topicContext?: TopicContext
): string => {
	const contextSection = buildTopicContextSection(topicContext);
	const issueList = issues.map((issue, i) => `${i}. [${issue.source}] ${issue.text}`).join('\n');
	return `テーマ「${topicTitle}」について挙がった以下の論点には、表現は違っても実質的に同じことを問うている重複が含まれます。重複している論点を洗い出してグループにまとめてください。

【論点一覧（index: 論点テキスト）】
${issueList}

【判定基準】
- 「結局そこで何を問うているのか」が同じ論点は重複とみなす。一般の素朴な疑問と専門的な論点が、同じことを別の言い方で問うている場合も重複に含む。
- 財源・効果・公平性・時期などの切り口や観点が異なるだけの論点は重複ではない（別々の論点として残す）。あくまで同じ問いの言い換えだけを重複とする。

実質的に同じ問いをまとめた duplicateGroups（各グループは重複する論点の index 配列）を返してください。重複が1つもなければ空配列を返してください。${contextSection}`;
};

const selectIssues = (issues: Issue[]): Issue[] => {
	if (issues.length === 0) return [];

	const aboveThreshold = issues.filter((issue) => (issue.score ?? 0) >= SCORE_THRESHOLD);
	const selected =
		aboveThreshold.length > 0
			? aboveThreshold
			: [issues.reduce((best, issue) => ((issue.score ?? 0) > (best.score ?? 0) ? issue : best))];

	const hasGeneral = selected.some((issue) => issue.source === 'general');
	if (!hasGeneral) {
		const generalIssues = issues.filter((issue) => issue.source === 'general');
		if (generalIssues.length > 0) {
			const bestGeneral = generalIssues.reduce((best, issue) =>
				(issue.score ?? 0) > (best.score ?? 0) ? issue : best
			);
			if (!selected.includes(bestGeneral)) {
				return [...selected, bestGeneral];
			}
		}
	}

	return selected;
};

const groupIssues = async (
	topicTitle: string,
	issues: Issue[],
	topicContext?: TopicContext
): Promise<IssueGroup[]> => {
	const selectedWithGlobalIdx = issues
		.map((issue, globalIdx) => ({ issue, globalIdx }))
		.filter(({ issue }) => issue.selected === true);

	const result = await generateObject({
		model: anthropic(AI_MODELS.SONNET),
		system: buildNeutralitySystemPrompt(),
		schema: groupingResultSchema,
		messages: [
			{
				role: 'user',
				content: buildGroupingPrompt(
					topicTitle,
					selectedWithGlobalIdx.map((entry) => entry.issue),
					topicContext
				)
			}
		]
	});

	const groups = result.object.issueGroups;

	if (groups.length === 0) {
		return [{ issueIndexes: selectedWithGlobalIdx.map((entry) => entry.globalIdx) }];
	}

	const assignedLocalIdxs = new Set<number>();
	const issueGroups: IssueGroup[] = groups.map((group) => ({
		issueIndexes: group.issueIndexes
			.filter((localIdx) => localIdx >= 0 && localIdx < selectedWithGlobalIdx.length)
			.map((localIdx) => {
				assignedLocalIdxs.add(localIdx);
				return selectedWithGlobalIdx[localIdx].globalIdx;
			})
	}));

	const unassigned = selectedWithGlobalIdx
		.filter((_, localIdx) => !assignedLocalIdxs.has(localIdx))
		.map((entry) => entry.globalIdx);

	if (unassigned.length > 0) {
		issueGroups[issueGroups.length - 1].issueIndexes.push(...unassigned);
	}

	return issueGroups.filter((group) => group.issueIndexes.length > 0);
};

const buildGroupingPrompt = (
	topicTitle: string,
	selectedIssues: Issue[],
	topicContext?: TopicContext
): string => {
	const contextSection = buildTopicContextSection(topicContext);
	const issueList = selectedIssues
		.map((issue, i) => `${i}. [${issue.source}] ${issue.text}`)
		.join('\n');
	return `${CHAPTER_GENERATION_GOAL}

テーマ「${topicTitle}」の採用論点を章立てします。各グループが1つの章＝1つの主題になります。タイトルは生成しない。

【採用論点（index: 論点テキスト）】
${issueList}

【手順】
1. まず、この討論を貫く「大きな主題」を数個だけ見つける。主題とは、読み手が「この章は結局この話」と一言で言える討論の柱のこと。個々の細かい切り口をそのまま主題にしない。
2. 次に、すべての論点をその数個の主題のいずれかに割り当てる。問いの核が同じ・重なる論点は同じ主題に入れる。金額・制度名・登場人物といった表面的な題材が違っても、核が同じなら同じ主題にまとめる。

【考え方】
- 論点の数だけ章を作らない。まず主題を数個に絞り、そこへ論点を振り分ける発想で臨む。
- 同じ対象（同じ制度・施策・期間・当事者）を、財源・効果・公平性・時期・実現性などの異なる切り口から論じているだけの論点は、切り口が違っても1つの主題に束ねる。切り口ごとに章を分けない。（例:「◯◯の財源はどうするか」と「◯◯は本当に効果があるか」は、どちらも◯◯という同じ対象の是非なので同じ主題）
- 論点1つだけで立つ主題は原則作らない。近い主題に束ねられないか必ず検討する。
- 主題が明確で読み手が筋を追えることが最優先。迷ったら分けずにまとめる。
- index の配列のみを返す。タイトルは不要。

各グループ（主題）の issueIndexes（論点の index 配列）を返してください。全論点を漏れなくいずれかの主題へ割り当ててください。${contextSection}`;
};

const buildChapters = async (
	topicTitle: string,
	issueGroups: IssueGroup[],
	issues: Issue[],
	topicContext?: TopicContext
): Promise<Chapter[]> => {
	const result = await generateObject({
		model: anthropic(AI_MODELS.SONNET),
		system: buildNeutralitySystemPrompt(),
		schema: chapterResultSchema,
		messages: [
			{
				role: 'user',
				content: buildBuildingPrompt(topicTitle, issueGroups, issues, topicContext)
			}
		]
	});

	return issueGroups.map((group, i) => {
		const authored = result.object.chapters[i];
		const fallbackPoints = group.issueIndexes.map((issueIndex) => issues[issueIndex]?.text ?? '');
		return {
			id: nanoid(),
			title: authored?.title ?? topicTitle,
			agenda: authored?.agenda ?? fallbackPoints
		};
	});
};

const buildBuildingPrompt = (
	topicTitle: string,
	issueGroups: IssueGroup[],
	issues: Issue[],
	topicContext?: TopicContext
): string => {
	const contextSection = buildTopicContextSection(topicContext);
	const groupList = issueGroups
		.map((group, i) => {
			const issueTexts = group.issueIndexes
				.map((issueIndex) => `- ${issues[issueIndex]?.text ?? ''}`)
				.join('\n');
			return `## グループ ${i + 1}\n${issueTexts}`;
		})
		.join('\n\n');
	return `${CHAPTER_GENERATION_GOAL}

テーマ「${topicTitle}」の各グループ（＝各章）について、章タイトルと agenda を生成してください。

【グループと論点】
${groupList}

【章タイトルと agenda の考え方】
- 章タイトルはその章の主題を一言で表す。agenda はその主題を討論で扱うための「問い」のリスト。
- agenda は、割り当てられた論点を問いに言い換えたもの。選ばれた論点がそのまま素材であり、新しい論点を足したり1つの論点を水増しで分割したりしない（読みやすさを損ね、討論で同じ話が繰り返される）。同一主題内で実質的に重複する論点だけは1つの問いに束ねる。
- 各 agendaItem は、割り当て論点の中身を保ったまま、専門知識のない一般の人が日常感覚で理解できる「問いの形」にする（例:「〜なのはなぜか」「どこまでなら許されるか」）。第1章は特に平易にする。
- 特定のペルソナ名・発言を前提にしない汎用的な問いにする。他の章の主題に踏み込む問いは作らない。

入力のグループ順のまま、各グループの title と agenda（文字列配列）を返してください。${contextSection}`;
};

export const sortChaptersByGeneralIssueCount = (
	chapters: Chapter[],
	issueGroups: IssueGroup[],
	issues: Issue[]
): Chapter[] => {
	const indexed = chapters.map((chapter, i) => ({ chapter, groupIdx: i }));
	indexed.sort((a, b) => {
		const countA = issueGroups[a.groupIdx].issueIndexes.filter(
			(issueIndex) => issues[issueIndex]?.source === 'general'
		).length;
		const countB = issueGroups[b.groupIdx].issueIndexes.filter(
			(issueIndex) => issues[issueIndex]?.source === 'general'
		).length;
		return countB - countA;
	});
	return indexed.map((entry) => entry.chapter);
};

export type ChapterProgress =
	| { step: 'issues_generated'; issues: Issue[] }
	| { step: 'issues_scored'; issues: Issue[] }
	| { step: 'issues_grouped'; issueGroups: IssueGroup[] };

export const generateChapters = async (
	topicTitle: string,
	personas: Persona[],
	topicContext?: TopicContext,
	onProgress?: (progress: ChapterProgress) => void | Promise<void>
): Promise<Result<Chapter[], PipelineError>> => {
	try {
		const contextSection = buildTopicContextSection(topicContext);
		const [generalIssuesResult, personaIssuesResult] = await Promise.all([
			generateObject({
				model: anthropic(AI_MODELS.SONNET),
				system: buildNeutralitySystemPrompt(),
				schema: issuesSchema,
				messages: [
					{
						role: 'user',
						content: `テーマ「${topicTitle}」について、専門知識を持たない一般の人々が最初に感じる素朴な疑問や関心事を5〜7件列挙してください。\n\nテーマの方向性が示されている場合は、その方向性に沿った切り口に絞ってください。末尾に【確定した客観的事実（共通前提）】が示されている場合は、その事実の中身を踏まえて論点を具体化してください。日常の感覚で「自分にも関係ある」「なんとなく気になる」と思える切り口にし、固有名詞（特定の企業・人名・政策名）や専門用語は避け、金額や事例などの事実も平易な言葉に噛み砕いて表現してください。各切り口を1〜2文で記述してください。${contextSection}`
					}
				]
			}),
			generateObject({
				model: anthropic(AI_MODELS.SONNET),
				system: buildNeutralitySystemPrompt(),
				schema: issuesSchema,
				messages: [
					{
						role: 'user',
						content: `テーマ「${topicTitle}」について、以下の参加者それぞれの立場・専門性・利害関係から生まれる具体的な論点や関心事を5〜8件列挙してください。\n\nテーマの方向性が示されている場合は、その方向性の範囲内で論点を生成してください。\n\n参加者:\n${formatPersonas(personas)}\n\n各参加者が自身の立場・専門性・利害から強い関心や懸念を持つ側面を取り上げてください。末尾に【確定した客観的事実（共通前提）】が示されている場合は、その事実を踏まえて論点を具体化してください。各切り口を1〜2文で記述してください。${contextSection}`
					}
				]
			})
		]);

		const issues: Issue[] = [
			...generalIssuesResult.object.issues.map((text) => ({
				id: nanoid(),
				text,
				source: 'general' as const
			})),
			...personaIssuesResult.object.issues.map((text) => ({
				id: nanoid(),
				text,
				source: 'persona' as const
			}))
		];

		await onProgress?.({ step: 'issues_generated', issues });

		const scoredIssues = await scoreIssues(topicTitle, issues, topicContext);
		const dedupedIssues = await dedupeIssues(topicTitle, scoredIssues, topicContext);
		const selectedIssues = selectIssues(dedupedIssues);

		const issuesWithSelection: Issue[] = scoredIssues.map((issue) => ({
			...issue,
			selected: selectedIssues.includes(issue)
		}));

		await onProgress?.({ step: 'issues_scored', issues: issuesWithSelection });

		const issueGroups = await groupIssues(topicTitle, issuesWithSelection, topicContext);

		await onProgress?.({ step: 'issues_grouped', issueGroups });

		const chapters = await buildChapters(
			topicTitle,
			issueGroups,
			issuesWithSelection,
			topicContext
		);
		const sortedChapters = sortChaptersByGeneralIssueCount(
			chapters,
			issueGroups,
			issuesWithSelection
		);

		return { ok: true, value: sortedChapters };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
	}
};
