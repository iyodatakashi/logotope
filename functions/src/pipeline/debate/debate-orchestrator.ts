import { getTopicById } from '../topics/topics.js';
import { getPersonasByTopicId } from '../personas/personas.js';
import { getChaptersByTopicId } from './debate-lifecycle.js';
import type { ChapterEntry } from './debate-lifecycle.js';
import {
	generateOpening,
	generateChapterIntroduction,
	evaluateDiscussionPointCoverage
} from '../../agents/facilitator-agent.js';
import { selectSpeaker } from './speaker-selection.js';
import { getDebateState } from './debate-state.js';
import {
	MAX_PAIR_CONVERSATION_TURNS,
	CHAPTER_END_COUNT_LIMIT,
	EARLY_END_PROGRESS_RATIO,
	TURN_CAP_RATIO,
	AGENDA_TURN_CAP_RATIO,
	CONTINUE_CHAPTER_THRESHOLD,
	TURNS_PER_CHAPTER,
	MAX_TURNS,
	DEFAULT_INTERVENTION_COOLDOWN
} from '../../constants/debate.constants.js';
import { evaluateEngagements, evaluateEngagementWithFallback } from './engagement.js';
import { expireQueuedIntents, addQueuedIntents, consumeQueuedIntent, loadQueuedIntents } from './queued-intents.js';
import { tryIntervention } from './intervention.js';
import {
	isDebateActive,
	generateFacilitatorTurn,
	generatePersonaTurn,
	generateChapterTransition,
	finalizeDebate,
	updateSpeakerStats,
	applyBeliefChange,
	getDebateTurnsByTopicId
} from './turn.js';
import { pipelineErrorMessage, validPersonaId } from './utils.js';
import type { SpeakerSelection, DebateState, DebateTurn, DebateOptions } from '../../types/debate.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { Persona } from '../../types/persona.types.js';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

const db = () => getFirestore();

export const DEFAULT_OPTIONS: DebateOptions = {
	turnsPerChapter: TURNS_PER_CHAPTER,
	maxTurns: MAX_TURNS,
	interventionCooldown: DEFAULT_INTERVENTION_COOLDOWN
};

/** @returns 次章が存在する場合 true（呼び出し元が次章タスクを投入する） */
export const executeChapterTask = async (
	topicId: string,
	chapterIndex: number,
	options: DebateOptions = { turnsPerChapter: TURNS_PER_CHAPTER, maxTurns: MAX_TURNS, interventionCooldown: DEFAULT_INTERVENTION_COOLDOWN }
): Promise<boolean> => {
	// 停止ゲート: トピックが討論かつ実行中でなければ何も生成・上書きしない
	if (!(await isDebateActive(topicId))) return false;

	const chapters = await getChaptersByTopicId(topicId);
	if (!chapters.length) throw new Error('Chapters not found');

	// 冪等性: 完了済みの章はスキップする
	const chapterDoc = chapters[chapterIndex];
	if (!chapterDoc) throw new Error(`Chapter not found: ${chapterIndex}`);
	if (chapterDoc.status === 'completed') {
		return chapterIndex < chapters.length - 1;
	}

	const { personas, topicTitle } = await getTopicContext(topicId);

	const existingTurns = await getDebateTurnsByTopicId(topicId);
	const persistedQueuedIntents = await loadQueuedIntents(topicId);
	const state = getDebateState(existingTurns, personas, persistedQueuedIntents);

	const chapter: Chapter = chapterDoc;

	// 章の既存ターン数を記録して章ターンカウント・チャプターターンスライスに使用する
	const chapterTurnStartInState = existingTurns.length - chapterDoc.turns.length;
	const getChapterTurns = (): DebateTurn[] => state.turns.slice(chapterTurnStartInState);
	const chapterTurnCount = (): number => state.turns.length - chapterTurnStartInState;

	await updateChapterStatus(topicId, chapterDoc.id, 'running');

	const { turnsPerChapter, maxTurns, interventionCooldown } = options;

	// 論点ステータスを章の discussionPoints から初期化する（タスク再実行時も全 untouched でリセット）
	state.discussionPoints = (chapter.discussionPoints ?? []).map((point) => ({
		point,
		status: 'untouched' as const
	}));

	const hasPoints = state.discussionPoints.length > 0;
	const cap = Math.ceil(turnsPerChapter * (hasPoints ? AGENDA_TURN_CAP_RATIO : TURN_CAP_RATIO));
	let chapterEndCount = 0;

	// 章開始: 第1章はオープニング、2章以降は導入を生成（章立ては generateChapters で事前に保存済み）
	if (chapterTurnCount() === 0) {
		// 全論点を「未着手」として先に保存することで、ファシリテーター発言より先に「着」が表示されるのを防ぐ
		await saveDiscussionPointStatuses(topicId, chapterDoc.id, state);
		if (chapterIndex === 0) {
			const openingResult = await generateOpening(topicTitle, personas, chapter);
			if (!openingResult.ok) throw new Error(pipelineErrorMessage(openingResult.error));
			await generateFacilitatorTurn({
				topicId,
				state,
				chapterId: chapterDoc.id,
				content: openingResult.value.content ?? '',
				targetPersonaId: validPersonaId(openingResult.value.targetPersonaId, personas)
			});
			markIntroduced(state, openingResult.value.selectedDiscussionPointIndex);
			await saveDiscussionPointStatuses(topicId, chapterDoc.id, state);
		} else {
			const introResult = await generateChapterIntroduction(chapter, personas);
			if (introResult.ok) {
				await generateFacilitatorTurn({
					topicId,
					state,
					chapterId: chapterDoc.id,
					content: introResult.value.content ?? '',
					targetPersonaId: validPersonaId(introResult.value.targetPersonaId, personas)
				});
				markIntroduced(state, introResult.value.selectedDiscussionPointIndex);
				await saveDiscussionPointStatuses(topicId, chapterDoc.id, state);
			}
		}
	}

	while (chapterTurnCount() < cap && state.turns.length < maxTurns) {
		if (!(await isDebateActive(topicId))) return false;
		const shouldContinueChapter = await executeTurn({
			topicId,
			personas,
			chapter,
			chapterId: chapterDoc.id,
			state,
			getChapterTurns,
			chapterTurnStartInState,
			interventionCooldown
		});
		if (shouldContinueChapter === null) return false;
		chapterEndCount = shouldContinueChapter ? 0 : chapterEndCount + 1;
		if (
			chapterTurnCount() >= Math.ceil(turnsPerChapter * EARLY_END_PROGRESS_RATIO) &&
			chapterEndCount >= CHAPTER_END_COUNT_LIMIT
		) {
			const incomplete = state.discussionPoints.filter((p) => p.status !== 'addressed');
			if (incomplete.length > 0) {
				const coverageResult = await evaluateDiscussionPointCoverage(
					getChapterTurns(),
					incomplete.map((p) => p.point),
					personas
				);
				if (coverageResult.ok) {
					for (const idx of coverageResult.value) {
						const target = state.discussionPoints.find((p) => p.point === incomplete[idx]?.point);
						if (target) target.status = 'addressed';
					}
					await saveDiscussionPointStatuses(topicId, chapterDoc.id, state);
					if (state.discussionPoints.some((p) => p.status !== 'addressed')) {
						chapterEndCount = 0;
						continue;
					}
				}
				// coverageResult 失敗 → フォールバックで break
			}
			break;
		}
	}

	// 章終了時に未応答の指名が残っていれば応答ターンを1件生成する（+1ターン許容）
	const unansweredTarget = getLastTargetPersona(state.turns);
	const speakerSelection: SpeakerSelection | undefined = unansweredTarget
		? {
				personaId: unansweredTarget.personaId,
				reason:
					unansweredTarget.targetedBy === 'facilitator'
						? 'targeted_by_facilitator'
						: 'targeted_by_persona'
			}
		: undefined;
	if (speakerSelection) {
		const engagements = await evaluateEngagements({ topicId, personas, state });
		const engagement = await evaluateEngagementWithFallback({
			personaId: speakerSelection.personaId,
			personas,
			turns: state.turns,
			engagements
		});
		const reply = await generatePersonaTurn({
			topicId,
			personas,
			chapter,
			state,
			speakerSelection,
			engagement,
			chapterTurnStartIndex: chapterTurnStartInState
		});
		if (reply) {
			updateSpeakerStats({ state, personas, personaId: reply.personaId });
			await consumeQueuedIntent({
				topicId,
				state,
				personaId: reply.personaId,
				queuedEntries: reply.queuedEntries
			});
			if (reply.beliefChange)
				await applyBeliefChange({
					topicId,
					persona: personas.find((p) => p.id === reply.personaId)!,
					turnId: reply.turnId,
					beliefChange: reply.beliefChange
				});
		}
	}

	await updateChapterStatus(topicId, chapterDoc.id, 'completed');
	await deleteDiscussionPointStatuses(topicId, chapterDoc.id);

	const isLastChapter = options.singleChapterMode || chapterIndex >= chapters.length - 1;
	if (isLastChapter) {
		await finalizeDebate({ topicId, personas, state, chapterId: chapterDoc.id });
		return false;
	}
	await generateChapterTransition({ topicId, chapter, state, personas });
	return true;
};

const getTopicContext = async (topicId: string) => {
	const [topic, allPersonas] = await Promise.all([
		getTopicById(topicId),
		getPersonasByTopicId(topicId)
	]);
	if (!topic) throw new Error(`Topic not found: ${topicId}`);
	return { topicTitle: topic.title, personas: allPersonas.filter((p) => p.approved) };
};

/**
 * 正準フロー「1ターン処理」: 「停止ゲート → 全員評価 → 話者決定 → 発言パラメータ取得 → 発言生成・保存 → 状態更新」の固定順で進行する。
 * 話者決定の優先順位: 指名・直接質問 > A（論点ずれ、クールダウン後かつ指名なし時のみ評価）> B（出尽くし、高意欲者なし時のみ評価・クールダウン不問）> キュー > スコア。
 */
const executeTurn = async ({
	topicId,
	personas,
	chapter,
	chapterId,
	state,
	getChapterTurns,
	chapterTurnStartInState,
	interventionCooldown
}: {
	topicId: string;
	personas: Persona[];
	chapter: Chapter;
	chapterId: string;
	state: DebateState;
	getChapterTurns: () => DebateTurn[];
	chapterTurnStartInState: number;
	interventionCooldown: number;
}): Promise<boolean | null> => {
	// 1. 前ターン由来の指名を取り出す
	const targetPersona = getLastTargetPersona(state.turns);

	// 2. 失効した発言意図をキューから除去する
	await expireQueuedIntents({ topicId, state });

	// 3. 全員の発言意欲を評価する（直前話者を除く）
	const engagements = await evaluateEngagements({ topicId, personas, state });

	// 4. ファシリテーター介入（介入した場合は早期終了）
	const canContinuePairConversation = state.pairConversationTurns < MAX_PAIR_CONVERSATION_TURNS;

	if (!targetPersona || !canContinuePairConversation) {
		const intervened = await tryIntervention({
			topicId,
			personas,
			chapter,
			state,
			engagements,
			interventionCooldown,
			chapterTurns: getChapterTurns()
		});
		if (intervened) {
			await saveDiscussionPointStatuses(topicId, chapterId, state);
			return true;
		}
	}

	// 5. 話者を決定する（指名 > キュー > スコア順）
	const speakerSelection = selectSpeaker({
		targetPersona,
		canContinuePairConversation,
		engagements,
		state,
		personas
	});

	// 6. 高意欲者の発言意図をキューに積む
	await addQueuedIntents({
		topicId,
		state,
		engagements,
		speakerSelection,
		triggerTurnIndex: Math.max(0, state.turns.length - 1)
	});

	// 7. ペア会話ターン数を更新する（ペルソナ間指名の連続回数を管理する）
	state.pairConversationTurns =
		speakerSelection.reason === 'targeted_by_persona' ? state.pairConversationTurns + 1 : 0;

	// 8. 発言パラメータ（モード・スコア・意図）を決定する（直前話者など評価対象外の場合は単独評価）
	const engagement = await evaluateEngagementWithFallback({
		personaId: speakerSelection.personaId,
		personas,
		turns: state.turns,
		engagements
	});

	// 9. ペルソナターンを生成・保存する
	const reply = await generatePersonaTurn({
		topicId,
		personas,
		chapter,
		state,
		speakerSelection,
		engagement,
		chapterTurnStartIndex: chapterTurnStartInState
	});
	if (!reply) return null;

	// 10. 消化した発言意図をキューから除去する
	await consumeQueuedIntent({
		topicId,
		state,
		personaId: reply.personaId,
		queuedEntries: reply.queuedEntries
	});

	// 11. 話者統計を更新する
	updateSpeakerStats({ state, personas, personaId: reply.personaId });

	// 12. 信念変化を記録する
	if (reply.beliefChange)
		await applyBeliefChange({
			topicId,
			persona: personas.find((p) => p.id === reply.personaId)!,
			turnId: reply.turnId,
			beliefChange: reply.beliefChange
		});

	// 13. 章継続判定を返す
	return engagements.length === 0 || engagements.some((a) => a.score >= CONTINUE_CHAPTER_THRESHOLD);
};

const saveDiscussionPointStatuses = async (topicId: string, chapterId: string, state: DebateState): Promise<void> => {
	if (state.discussionPoints.length === 0) return;
	await db().doc(`topics/${topicId}/chapters/${chapterId}`).update({
		discussionPointStatuses: state.discussionPoints.map((p) => ({ point: p.point, status: p.status }))
	});
};

const deleteDiscussionPointStatuses = async (topicId: string, chapterId: string): Promise<void> => {
	await db().doc(`topics/${topicId}/chapters/${chapterId}`).update({
		discussionPointStatuses: FieldValue.delete()
	});
};

const markIntroduced = (state: DebateState, index: number | undefined): void => {
	if (index === undefined) return;
	const untouched = state.discussionPoints.filter((p) => p.status !== 'addressed');
	const target = untouched[index] !== undefined
		? state.discussionPoints.find((p) => p.point === untouched[index].point)
		: undefined;
	if (target) target.status = 'introduced';
};

const getLastTargetPersona = (
	turns: DebateTurn[]
): { personaId: string; targetedBy: 'facilitator' | 'persona' } | undefined => {
	const last = turns[turns.length - 1];
	if (!last?.targetPersonaId || !last.targetedBy) return undefined;
	return { personaId: last.targetPersonaId, targetedBy: last.targetedBy };
};

const updateChapterStatus = async (
	topicId: string,
	chapterId: string,
	status: ChapterEntry['status']
): Promise<void> => {
	await db().doc(`topics/${topicId}/chapters/${chapterId}`).update({ status });
};
