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

const scoringResultSchema = z.object({
	scoredIssues: z.array(
		z.object({
			index: z.number().int(),
			score: z.number().int().min(0).max(10),
			reason: z.string()
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
			discussionPoints: z.array(z.string())
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
	return `テーマ「${topicTitle}」の採用論点を意味的な近さでグループ化してください。タイトルは生成しない。

【採用論点（index: 論点テキスト）】
${issueList}

【グループ化のルール】
- 意味的に近い論点を同じグループにまとめる
- index の配列のみを返す。タイトルは不要
- 採用論点が収束している場合、グループ数1を許容する

各グループの issueIndexes（論点の index 配列）を返してください。全論点がいずれかのグループに割り当てられるよう漏れなく配置してください。${contextSection}`;
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
			discussionPoints: authored?.discussionPoints ?? fallbackPoints
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
	return `テーマ「${topicTitle}」の各グループについて、割り当て論点を素材に章タイトルと discussionPoints を生成してください。

【グループと論点】
${groupList}

【再構成のルール】
- 各グループに対応する章の title と discussionPoints を生成する。discussionPoints は統合後に実質的に異なる論点だけを残し、件数は問わない（無理に増やさない・水増ししない）
- 各 discussionPoint は、専門知識のない一般の人々が日常感覚で理解できる「問いの形」で書く（例:「〜なのはなぜか」「どこまでなら許されるか」）
- 第1章の論点は特に平易で日常的な表現にする
- 章内・章間で意味的に重複する論点は1つに寄せ、各論点は最も適切な1つの章にのみ属させる。他の章の主題に踏み込む問いは作らない
- 特定のペルソナ名・発言を前提にしない汎用的な問いの形で生成する

入力のグループ順のまま、各グループの title と discussionPoints（文字列配列）を返してください。${contextSection}`;
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
		const selectedIssues = selectIssues(scoredIssues);

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
