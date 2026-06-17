import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import {
	getTopicById,
	getPersonasByTopicId,
	getDebateSessionByTopicId
} from '../../db/repository.js';
import {
	generateOpening,
	evaluateTopicDrift,
	evaluateStallIntervention,
	generateClosing,
	generateChapterSummary,
	generateChapterIntroduction
} from '../../agents/facilitator-agent.js';
import {
	generateTurn,
	assessEngagement,
	generatePostDebateComment
} from '../../agents/persona-agent.js';
import { selectSpeaker, shouldQueue, shouldSpeak } from './speaker-selection.js';
import {
	checkChapterContinuation,
	hasReachedEarlyEnd,
	chapterTurnCap
} from './chapter-progress.js';
import { shouldEvaluateIntervention } from './intervention-policy.js';
import { restoreDebateState } from './state-restore.js';
import {
	INTENT_EXPIRY_TURNS,
	MAX_PAIR_CONVERSATION_TURNS
} from '../../constants/flow.constants.js';
import type { SpeakerSelection, PendingIntent } from '../../types/debate.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { PipelineError } from '../../types/common.types.js';
import type { Engagement, DebateState, BeliefChangeEvent } from '../../types/debate.types.js';
import type { DebateTurn } from '../../types/debate.types.js';
import type { Persona } from '../../types/persona.types.js';
import { DEFAULT_OPTIONS } from '../../constants/debate-orchestrator.constants.js';
import type { DebateOptions } from '../../types/debate.types.js';

/** @returns 次章が存在する場合 true（呼び出し元が次章タスクを投入する） */
export const executeChapterTask = async (
	topicId: string,
	chapterIndex: number,
	options: DebateOptions = DEFAULT_OPTIONS
): Promise<boolean> => {
	// 停止ゲート: トピックが討論かつ実行中でなければ何も生成・上書きしない
	if (!(await isDebateActive(topicId))) return false;

	const session = await getDebateSessionByTopicId(topicId);
	if (!session) throw new Error('Session not found');
	if (!session.chapters?.length) throw new Error('Chapters not found');

	// 冪等性: 処理済みの章はスキップする
	if (session.currentChapterIndex !== undefined && session.currentChapterIndex > chapterIndex) {
		return chapterIndex < (session.chapters?.length ?? 0) - 1;
	}

	const { personas, topicTitle } = await getTopicContext(topicId);

	const existingTurns = await getDebateTurnsByTopicId(topicId);
	const persistedPendingIntents = await loadPendingIntents(topicId);
	const state = restoreDebateState(existingTurns, personas, persistedPendingIntents);

	const chapters: Chapter[] = session.chapters ?? [];

	if (!chapters[chapterIndex]) throw new Error(`Chapter not found: ${chapterIndex}`);
	await updateCurrentChapterIndex(topicId, chapterIndex);

	const chapter = chapters[chapterIndex];
	const { turnsPerChapter, maxTurns, interventionCooldown } = options;
	const cap = chapterTurnCap(turnsPerChapter);
	let chapterEndCount = 0;
	const chapterTurnCount = () => state.turns.filter((t) => t.chapterId === chapter.id).length;

	// 章開始: 第1章はオープニング、2章以降は導入を生成（章立ては generateChapters で事前に保存済み）
	if (chapterTurnCount() === 0) {
		if (chapterIndex === 0) {
			const openingResult = await generateOpening(topicTitle, personas, chapter);
			if (!openingResult.ok) throw new Error(pipelineErrorMessage(openingResult.error));
			await generateFacilitatorTurn({
				topicId,
				state,
				chapterId: chapter.id,
				content: openingResult.value.content ?? '',
				targetPersonaId: validPersonaId(openingResult.value.targetPersonaId, personas)
			});
		} else {
			const introResult = await generateChapterIntroduction(chapter, personas);
			if (introResult.ok) {
				await generateFacilitatorTurn({
					topicId,
					state,
					chapterId: chapter.id,
					content: introResult.value.content ?? '',
					targetPersonaId: validPersonaId(introResult.value.targetPersonaId, personas)
				});
			}
		}
	}

	while (chapterTurnCount() < cap && state.turns.length < maxTurns) {
		if (!(await isDebateActive(topicId))) return false;
		const shouldContinueChapter = await executeTurn({
			topicId,
			personas,
			chapter,
			state,
			interventionCooldown
		});
		if (shouldContinueChapter === null) return false;
		chapterEndCount = shouldContinueChapter ? 0 : chapterEndCount + 1;
		if (hasReachedEarlyEnd(chapterTurnCount(), turnsPerChapter, chapterEndCount)) break;
	}

	// 章終了時に未応答の指名が残っていれば応答ターンを1件生成する（+1ターン許容）
	const unansweredTarget = state.targetPersona;
	state.targetPersona = undefined;
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
		const engagements = await evaluateEngagement({ topicId, personas, state });
		const speech = await resolveSpeechParams({
			speakerId: speakerSelection.personaId,
			personas,
			state,
			engagements
		});
		const reply = await generatePersonaTurn({
			topicId,
			personas,
			chapter,
			state,
			speakerSelection,
			speech
		});
		if (reply) {
			updateSpeakerStats({ state, personas, personaId: reply.personaId });
			await consumePendingIntent({
				topicId,
				state,
				personaId: reply.personaId,
				pendingEntries: reply.pendingEntries
			});
			if (reply.beliefChange)
				await applyBeliefChange({
					topicId,
					persona: personas.find((p) => p.id === reply.personaId)!,
					turnId: reply.turnId,
					beliefChange: reply.beliefChange
				});
			// 章は終了するため、応答ターン由来の指名は引き継がない
			state.targetPersona = undefined;
		}
	}

	const isLastChapter = options.singleChapterMode || chapterIndex >= chapters.length - 1;
	if (isLastChapter) {
		await finalizeDebate({ topicId, personas, state });
		return false;
	}
	await generateChapterTransition({ topicId, chapter, state });
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
	state,
	interventionCooldown
}: {
	topicId: string;
	personas: Persona[];
	chapter: Chapter;
	state: DebateState;
	interventionCooldown: number;
}): Promise<boolean | null> => {
	// 1. 前ターン由来の指名を取り出す
	const targetPersona = state.targetPersona;
	state.targetPersona = undefined;

	// 2. 全員の発言意欲を評価する（直前話者を除く）
	const engagements = await evaluateEngagement({ topicId, personas, state });

	// 3. ファシリテーター介入
	const canContinuePairConversation = state.pairConversationTurns < MAX_PAIR_CONVERSATION_TURNS;

	if (!targetPersona || !canContinuePairConversation) {
		const intervened = await tryIntervention({
			topicId,
			personas,
			chapter,
			state,
			engagements,
			interventionCooldown
		});
		if (intervened) return true;
	}

	// 4. 話者を決定する（指名 > キュー > スコア順）
	const personaIds = personas.map((p) => p.id);
	const speakerSelection: SpeakerSelection =
		targetPersona && (targetPersona.targetedBy === 'facilitator' || canContinuePairConversation)
			? {
					personaId: targetPersona.personaId,
					reason:
						targetPersona.targetedBy === 'facilitator'
							? 'targeted_by_facilitator'
							: 'targeted_by_persona'
				}
			: selectSpeaker(
					engagements,
					state.pendingIntents,
					state.silenceMap,
					personaIds,
					state.lastSpeakerId
				);

	// 5. 高意欲者の発言意図をキューに積む
	await enqueueHighEngagementIntents({
		topicId,
		state,
		engagements,
		speakerSelection,
		triggerTurnIndex: Math.max(0, state.turns.length - 1)
	});

	// 6. ペア会話ターン数を更新する（ペルソナ間指名の連続回数を管理する）
	state.pairConversationTurns =
		speakerSelection.reason === 'targeted_by_persona' ? state.pairConversationTurns + 1 : 0;

	// 7. 発言パラメータ（モード・スコア・意図）を決定する
	const speech = await resolveSpeechParams({
		speakerId: speakerSelection.personaId,
		personas,
		state,
		engagements
	});

	// 8. ペルソナターンを生成・保存し、状態を更新する
	const reply = await generatePersonaTurn({
		topicId,
		personas,
		chapter,
		state,
		speakerSelection,
		speech
	});
	if (!reply) return null;
	updateSpeakerStats({ state, personas, personaId: reply.personaId });
	await consumePendingIntent({
		topicId,
		state,
		personaId: reply.personaId,
		pendingEntries: reply.pendingEntries
	});
	if (reply.beliefChange)
		await applyBeliefChange({
			topicId,
			persona: personas.find((p) => p.id === reply.personaId)!,
			turnId: reply.turnId,
			beliefChange: reply.beliefChange
		});
	state.targetPersona = reply.targetPersonaId
		? { personaId: reply.targetPersonaId, targetedBy: 'persona' }
		: undefined;

	// 9. 章継続判定を返す
	return checkChapterContinuation(engagements);
};

/** 直近のファシリテーターターン以降のペルソナターン数を返す（論点ずれ介入クールダウン判定用） */
export const countPersonaTurnsSinceFacilitator = (history: readonly DebateTurn[]): number => {
	const lastFacilitatorIdx = history.reduce(
		(max, t, i) => (t.speakerType === 'facilitator' ? i : max),
		-1
	);
	return history.slice(lastFacilitatorIdx + 1).filter((t) => t.speakerType === 'persona').length;
};

/**
 * 正準フロー「全員評価」ステップ: 毎ターン全員（直前話者除く）の発言意欲を評価し、
 * saveEngagements（可視化保存）・活性シグナル記録・キュー失効を行う。
 * 返り値は当ターンの評価結果（直前話者を除く）。キュー追加は話者決定後に行う（executeTurn 内）。
 */
const evaluateEngagement = async ({
	topicId,
	personas,
	state
}: {
	topicId: string;
	personas: Persona[];
	state: DebateState;
}): Promise<Engagement[]> => {
	// キュー失効（トリガーから INTENT_EXPIRY_TURNS 超過）を毎ターン適用し write-through
	for (const [personaId, items] of state.pendingIntents.entries()) {
		const alive = items.filter(
			(item) => state.turns.length - item.triggerTurnIndex <= INTENT_EXPIRY_TURNS
		);
		if (alive.length === items.length) continue;
		if (alive.length === 0) {
			state.pendingIntents.delete(personaId);
		} else {
			state.pendingIntents.set(personaId, alive);
		}
		await setPendingIntents({ topicId, personaId, items: alive });
	}

	// 直前話者を除く全員の発言意欲を評価する。評価失敗は最低意欲（score 1）として継続する
	const assessTargets = personas.filter((p) => p.id !== state.lastSpeakerId);
	const engagements = await Promise.all(
		assessTargets.map(async (p): Promise<Engagement> => {
			const result = await assessEngagement(p, state.turns);
			return result.ok ? result.value : { personaId: p.id, score: 1, mode: 'none' };
		})
	);

	// 評価結果を毎ターン保存する（管理画面での可視化用）
	await saveEngagements({
		topicId,
		turnIndex: Math.max(0, state.turns.length - 1),
		engagements: engagements.map((a) => ({
			personaId: a.personaId,
			score: a.score,
			mode: a.mode,
			intentSummary: a.intentSummary
		}))
	});

	return engagements;
};

/** 高意欲かつ非選択ペルソナのインテントをキューに追加し Firestore に write-through する */
const enqueueHighEngagementIntents = async ({
	topicId,
	state,
	engagements,
	speakerSelection,
	triggerTurnIndex
}: {
	topicId: string;
	state: DebateState;
	engagements: readonly Engagement[];
	speakerSelection: SpeakerSelection;
	triggerTurnIndex: number;
}): Promise<void> => {
	for (const engagement of engagements) {
		if (!shouldQueue(engagement) || engagement.personaId === speakerSelection.personaId) continue;
		const existing = state.pendingIntents.get(engagement.personaId) ?? [];
		const updated = [
			...existing,
			{ triggerTurnIndex, intentSummary: engagement.intentSummary ?? '' }
		];
		state.pendingIntents.set(engagement.personaId, updated);
		await setPendingIntents({ topicId, personaId: engagement.personaId, items: updated });
	}
};

/** 介入が必要か評価し、発火した場合は state を更新して true を返す */
const tryIntervention = async ({
	topicId,
	personas,
	chapter,
	state,
	engagements,
	interventionCooldown
}: {
	topicId: string;
	personas: Persona[];
	chapter: Chapter;
	state: DebateState;
	engagements: Engagement[];
	interventionCooldown: number;
}): Promise<boolean> => {
	let intervention: { content: string; targetPersonaId?: string } | undefined;
	if (
		shouldEvaluateIntervention(countPersonaTurnsSinceFacilitator(state.turns), interventionCooldown)
	) {
		intervention = await tryTopicDriftIntervention({ personas, chapter, state });
		if (!intervention) {
			intervention = await tryStallIntervention({ personas, chapter, state, engagements });
		}
	}
	if (!intervention) return false;

	await enqueueHighEngagementIntents({
		topicId,
		state,
		engagements,
		speakerSelection: { personaId: '', reason: 'score' },
		triggerTurnIndex: Math.max(0, state.turns.length - 1)
	});
	await persistInterventionTurn({
		topicId,
		state,
		content: intervention.content,
		targetPersonaId: intervention.targetPersonaId,
		chapterId: chapter.id
	});
	if (intervention.targetPersonaId) {
		state.targetPersona = { personaId: intervention.targetPersonaId, targetedBy: 'facilitator' };
	}
	return true;
};

/** 論点ずれチェック: 逸脱していれば介入を保存してSpeakerSelection を返す。クールダウン通過後かつ指名なし時のみ評価する */
const tryTopicDriftIntervention = async ({
	personas,
	chapter,
	state
}: {
	personas: Persona[];
	chapter: Chapter;
	state: DebateState;
}): Promise<{ content: string; targetPersonaId: string } | undefined> => {
	const chapterTurns = state.turns.filter((t) => t.chapterId === chapter.id);
	const result = await evaluateTopicDrift(
		chapterTurns as DebateTurn[],
		personas,
		state.speakCount,
		chapter
	);
	if (!result.ok) throw new Error(pipelineErrorMessage(result.error));
	if (!result.value.content) return undefined;
	const targetId = validPersonaId(result.value.targetPersonaId, personas);
	if (!targetId) return undefined;
	return { content: result.value.content, targetPersonaId: targetId };
};

/** 出尽くし介入: 高意欲者がいない場合のみ発火する。ドリフト介入と同じクールダウンを共有する */
const tryStallIntervention = async ({
	personas,
	chapter,
	state,
	engagements
}: {
	personas: Persona[];
	chapter: Chapter;
	state: DebateState;
	engagements: Engagement[];
}): Promise<{ content: string; targetPersonaId?: string } | undefined> => {
	if (shouldSpeak(engagements)) return undefined;
	const chapterTurns = state.turns.filter((t) => t.chapterId === chapter.id);
	const result = await evaluateStallIntervention(
		chapterTurns as DebateTurn[],
		personas,
		state.speakCount,
		chapter
	);
	if (!result.ok) throw new Error(pipelineErrorMessage(result.error));
	if (!result.value.content) return undefined;
	const targetId = validPersonaId(result.value.targetPersonaId, personas);
	return { content: result.value.content, targetPersonaId: targetId ?? undefined };
};

/** ファシリテーター介入ターンを保存し、ターゲットがあれば SpeakerSelection を返す */
export const persistInterventionTurn = async ({
	topicId,
	state,
	content,
	targetPersonaId,
	chapterId
}: {
	topicId: string;
	state: DebateState;
	content: string;
	targetPersonaId: string | undefined;
	chapterId: string;
}): Promise<SpeakerSelection | undefined> => {
	const turnIndex = state.turns.length;
	const { id: turnId } = await addTurn({
		topicId,
		turnIndex,
		speakerType: 'facilitator',
		speakerName: 'ファシリテーター',
		speakerRole: '',
		content,
		chapterId,
		targetPersonaId
	});
	state.turns.push({
		id: turnId,
		sessionId: topicId,
		turnIndex,
		speakerType: 'facilitator',
		speakerName: 'ファシリテーター',
		speakerRole: '',
		content,
		createdAt: new Date().toISOString(),
		chapterId,
		targetPersonaId
	});
	state.pairConversationTurns = 0;
	state.lastSpeakerId = undefined;
	return targetPersonaId
		? { personaId: targetPersonaId, reason: 'targeted_by_facilitator' }
		: undefined;
};

/** 選ばれた話者の発言パラメータ（mode/score・意図）を決める。evaluateEngagement の結果を優先し、評価対象外（直前話者など）のときのみ単独評価へフォールバックする */
const resolveSpeechParams = async ({
	speakerId,
	personas,
	state,
	engagements
}: {
	speakerId: string;
	personas: Persona[];
	state: DebateState;
	engagements?: ReadonlyArray<Engagement>;
}): Promise<Engagement> => {
	const existing = engagements?.find((a) => a.personaId === speakerId);
	if (existing) {
		return existing;
	}
	const persona = personas.find((p) => p.id === speakerId);
	if (!persona) return { personaId: speakerId, mode: 'opinion', score: 2 };
	const result = await assessEngagement(persona, state.turns);
	if (!result.ok) return { personaId: speakerId, mode: 'opinion', score: 2 };
	return result.value;
};

/** ファシリテーター発言を保存し、state.turns・state.targetPersona を更新して発言内容を返す */
const generateFacilitatorTurn = async ({
	topicId,
	state,
	content,
	targetPersonaId,
	chapterId
}: {
	topicId: string;
	state: DebateState;
	content: string;
	targetPersonaId?: string;
	chapterId?: string;
}): Promise<{ content: string; targetPersonaId?: string }> => {
	const turnIndex = state.turns.length;
	const { id: turnId } = await addTurn({
		topicId,
		turnIndex,
		speakerType: 'facilitator',
		speakerName: 'ファシリテーター',
		speakerRole: '',
		content,
		chapterId,
		targetPersonaId
	});
	state.turns.push({
		id: turnId,
		sessionId: topicId,
		turnIndex,
		speakerType: 'facilitator',
		speakerName: 'ファシリテーター',
		speakerRole: '',
		content,
		createdAt: new Date().toISOString(),
		chapterId,
		targetPersonaId
	});
	state.pairConversationTurns = 0;
	state.lastSpeakerId = undefined;
	state.targetPersona = targetPersonaId
		? { personaId: targetPersonaId, targetedBy: 'facilitator' }
		: undefined;
	return { content, targetPersonaId };
};

/** 決定に基づきペルソナ発言を生成・保存する。討論停止時は null を返す */
const generatePersonaTurn = async ({
	topicId,
	personas,
	chapter,
	state,
	speakerSelection,
	speech
}: {
	topicId: string;
	personas: Persona[];
	chapter: Chapter;
	state: DebateState;
	speakerSelection: SpeakerSelection;
	speech: Engagement;
}): Promise<{
	turnId: string;
	personaId: string;
	targetPersonaId: string | undefined;
	beliefChange: BeliefChangeEvent | null;
	pendingEntries: PendingIntent[] | undefined;
	fromQueue: boolean;
} | null> => {
	const persona = personas.find((p) => p.id === speakerSelection.personaId)!;
	const fromQueue = speakerSelection.reason === 'queue';

	const chapterTurns = state.turns.filter((t) => t.chapterId === chapter.id);
	const pendingEntries = state.pendingIntents.get(persona.id);
	let pendingTrigger: { speakerName: string; content: string } | undefined;
	if (pendingEntries && pendingEntries.length > 0) {
		const triggerTurn = state.turns.find((t) => t.turnIndex === pendingEntries[0].triggerTurnIndex);
		pendingTrigger = triggerTurn
			? { speakerName: triggerTurn.speakerName ?? '', content: triggerTurn.content }
			: undefined;
	}

	const turnResult = await generateTurn(
		persona,
		{
			chapterTurns,
			chapter,
			pendingTrigger,
			targetedBy:
				speakerSelection.reason === 'targeted_by_facilitator' ||
				speakerSelection.reason === 'targeted_by_persona'
					? speakerSelection.reason === 'targeted_by_facilitator'
						? 'facilitator'
						: 'persona'
					: undefined
		},
		{ ...speech, intentSummary: speakerSelection.intentSummary ?? speech.intentSummary }
	);
	if (!turnResult.ok) throw new Error(pipelineErrorMessage(turnResult.error));

	// 生成中に討論が停止された場合は、生成済みのセリフを保存せず状態も更新しない
	if (!(await isDebateActive(topicId))) return null;

	// 直接質問先は ID 検証のうえターンに永続化する（自分自身への指定は無視）
	const rawTarget = turnResult.value.targetPersonaId;
	const targetPersonaId =
		rawTarget !== persona.id ? validPersonaId(rawTarget, personas) : undefined;

	const turnIndex = state.turns.length;
	const { id: turnId } = await addTurn({
		topicId,
		turnIndex,
		speakerType: 'persona',
		personaId: persona.id,
		speakerName: persona.name,
		speakerRole: persona.specificRole,
		content: turnResult.value.content,
		chapterId: chapter.id,
		speechMode: turnResult.value.speechMode,
		engagementScore: speech.score,
		fromQueue: fromQueue || undefined,
		targetPersonaId,
		searchUsed: turnResult.value.searchUsed,
		searchQueries: turnResult.value.searchQueries
	});
	state.turns.push({
		id: turnId,
		sessionId: topicId,
		turnIndex,
		speakerType: 'persona',
		personaId: persona.id,
		speakerName: persona.name,
		speakerRole: persona.specificRole,
		content: turnResult.value.content,
		createdAt: new Date().toISOString(),
		chapterId: chapter.id,
		fromQueue: fromQueue || undefined,
		targetPersonaId
	});

	return {
		turnId,
		personaId: persona.id,
		targetPersonaId,
		beliefChange: turnResult.value.beliefChange,
		pendingEntries,
		fromQueue
	};
};

const updateSpeakerStats = ({
	state,
	personas,
	personaId
}: {
	state: DebateState;
	personas: Persona[];
	personaId: string;
}): void => {
	for (const p of personas) {
		state.silenceMap.set(p.id, p.id === personaId ? 0 : (state.silenceMap.get(p.id) ?? 0) + 1);
	}
	state.speakCount.set(personaId, (state.speakCount.get(personaId) ?? 0) + 1);
	state.lastSpeakerId = personaId;
};

const consumePendingIntent = async ({
	topicId,
	state,
	personaId,
	pendingEntries
}: {
	topicId: string;
	state: DebateState;
	personaId: string;
	pendingEntries: PendingIntent[] | undefined;
}): Promise<void> => {
	if (!pendingEntries || pendingEntries.length === 0) return;
	const remaining = pendingEntries.slice(1);
	if (remaining.length === 0) {
		state.pendingIntents.delete(personaId);
	} else {
		state.pendingIntents.set(personaId, remaining);
	}
	await setPendingIntents({ topicId, personaId, items: remaining });
};

const applyBeliefChange = async ({
	topicId,
	persona,
	turnId,
	beliefChange
}: {
	topicId: string;
	persona: Persona;
	turnId: string;
	beliefChange: BeliefChangeEvent;
}): Promise<void> => {
	const belief = getLatestBelief(persona);
	const newVersion = belief.version + 1;
	const savedBelief = await updatePersonaBelief({
		topicId,
		personaId: persona.id,
		version: newVersion,
		content: beliefChange.updatedBelief,
		changeType: beliefChange.type,
		changeSummary: beliefChange.summary,
		triggeredByTurnId: turnId
	});
	persona.beliefs = [
		...(persona.beliefs ?? []),
		{
			id: savedBelief.id,
			version: newVersion,
			content: beliefChange.updatedBelief,
			changeType: beliefChange.type,
			changeSummary: beliefChange.summary,
			triggeredByTurnId: turnId,
			createdAt: new Date().toISOString()
		}
	];
};

/** 章まとめ: 現章の議論をまとめるファシリテーターターンを生成する */
const generateChapterTransition = async ({
	topicId,
	chapter,
	state
}: {
	topicId: string;
	chapter: Chapter;
	state: DebateState;
}): Promise<void> => {
	const summaryResult = await generateChapterSummary(state.turns.slice(-10), chapter);
	if (summaryResult.ok) {
		await generateFacilitatorTurn({
			topicId,
			state,
			chapterId: chapter.id,
			content: summaryResult.value
		});
	}
};

/** 討論終端: クロージング → 事後コメント → セッション完了 */
const finalizeDebate = async ({
	topicId,
	personas,
	state
}: {
	topicId: string;
	personas: Persona[];
	state: DebateState;
}): Promise<void> => {
	const finalBeliefs = new Map(personas.map((p) => [p.id, getLatestBelief(p).content]));
	const closingResult = await generateClosing(state.turns, finalBeliefs);
	if (!closingResult.ok) throw new Error(pipelineErrorMessage(closingResult.error));
	await generateFacilitatorTurn({ topicId, state, content: closingResult.value ?? '' });

	for (let i = 0; i < personas.length; i++) {
		const persona = personas[i];
		const finalBelief = getLatestBelief(persona).content;
		const commentResult = await generatePostDebateComment(persona, finalBelief, state.turns);
		if (commentResult.ok) {
			await createPostDebateComment({
				topicId,
				personaId: persona.id,
				content: commentResult.value.content,
				sortOrder: i
			});
		}
	}

	await completeDebateSession(topicId, state.turns.length);
	await finalizeTopic(topicId);
};

const db = () => getFirestore();

const personaDocRef = (topicId: string, personaId: string) =>
	db().doc(`topics/${topicId}/personas/${personaId}`);

const isDebateActive = async (topicId: string): Promise<boolean> => {
	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) return false;
	const data = snap.data() as { phase?: number; phaseStatus?: string };
	return data.phase === 5 && data.phaseStatus === 'running';
};

const updateCurrentChapterIndex = async (topicId: string, index: number): Promise<void> => {
	await db().doc(`topics/${topicId}/sessions/0`).update({ currentChapterIndex: index });
};

const addTurn = async (params: {
	topicId: string;
	turnIndex: number;
	speakerType: 'persona' | 'facilitator';
	personaId?: string;
	speakerName?: string;
	speakerRole?: string;
	content: string;
	chapterId?: string;
	speechMode?: 'opinion' | 'fact';
	engagementScore?: number;
	fromQueue?: boolean;
	targetPersonaId?: string;
	searchUsed?: boolean;
	searchQueries?: string[];
}): Promise<{ id: string }> => {
	const id = nanoid();
	const turn: Record<string, unknown> = {
		id,
		turnIndex: params.turnIndex,
		speakerType: params.speakerType,
		content: params.content,
		createdAt: Timestamp.now()
	};
	if (params.personaId !== undefined) turn.personaId = params.personaId;
	if (params.speakerName !== undefined) turn.speakerName = params.speakerName;
	if (params.speakerRole !== undefined) turn.speakerRole = params.speakerRole;
	if (params.speechMode !== undefined) turn.speechMode = params.speechMode;
	if (params.engagementScore !== undefined) turn.engagementScore = params.engagementScore;
	if (params.fromQueue) turn.fromQueue = true;
	if (params.chapterId !== undefined) turn.chapterId = params.chapterId;
	if (params.targetPersonaId !== undefined) turn.targetPersonaId = params.targetPersonaId;
	if (params.searchUsed) turn.searchUsed = true;
	if (params.searchQueries?.length) turn.searchQueries = params.searchQueries;
	await db()
		.doc(`topics/${params.topicId}/sessions/0`)
		.update({ turns: FieldValue.arrayUnion(turn) });
	return { id };
};

const updatePersonaBelief = async (params: {
	topicId: string;
	personaId: string;
	version: number;
	content: string;
	changeType?: string;
	changeSummary?: string;
	triggeredByTurnId?: string;
}): Promise<{ id: string }> => {
	const id = nanoid();
	const belief: Record<string, unknown> = {
		id,
		version: params.version,
		content: params.content,
		createdAt: Timestamp.now()
	};
	if (params.changeType !== undefined) belief.changeType = params.changeType;
	if (params.changeSummary !== undefined) belief.changeSummary = params.changeSummary;
	if (params.triggeredByTurnId !== undefined) belief.triggeredByTurnId = params.triggeredByTurnId;
	await personaDocRef(params.topicId, params.personaId).update({
		beliefs: FieldValue.arrayUnion(belief)
	});
	return { id };
};

const createPostDebateComment = async (params: {
	topicId: string;
	personaId: string;
	content: string;
	sortOrder: number;
}): Promise<{ id: string }> => {
	const id = nanoid();
	await db()
		.doc(`topics/${params.topicId}/sessions/0`)
		.update({
			postDebateComments: FieldValue.arrayUnion({
				id,
				personaId: params.personaId,
				content: params.content,
				sortOrder: params.sortOrder
			})
		});
	return { id };
};

const completeDebateSession = async (topicId: string, totalTurns: number): Promise<void> => {
	await db()
		.doc(`topics/${topicId}/sessions/0`)
		.update({ totalTurns, completedAt: Timestamp.now() });
};

const finalizeTopic = async (topicId: string): Promise<boolean> => {
	const ref = db().doc(`topics/${topicId}`);
	return db().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		if (!snap.exists) return false;
		const data = snap.data() as { phaseStatus?: string };
		if (data.phaseStatus !== 'running') return false;
		tx.update(ref, { phaseStatus: 'generated', updatedAt: Timestamp.now() });
		return true;
	});
};

const saveEngagements = async (params: {
	topicId: string;
	turnIndex: number;
	engagements: Array<{
		personaId: string;
		score: number;
		mode: 'opinion' | 'fact' | 'none';
		intentSummary?: string;
	}>;
}): Promise<void> => {
	for (const engagement of params.engagements) {
		const ref = db().doc(`topics/${params.topicId}/sessions/0/engagements/${engagement.personaId}`);
		const entry: Record<string, unknown> = { score: engagement.score, mode: engagement.mode };
		if (engagement.intentSummary !== undefined) entry.intentSummary = engagement.intentSummary;
		await ref.set(
			{ history: { [String(params.turnIndex)]: entry } },
			{ mergeFields: [`history.${params.turnIndex}`] }
		);
	}
};

const setPendingIntents = async ({
	topicId,
	personaId,
	items
}: {
	topicId: string;
	personaId: string;
	items: ReadonlyArray<PendingIntent>;
}): Promise<void> => {
	await db()
		.doc(`topics/${topicId}/sessions/0/engagements/${personaId}`)
		.set({ pendingIntents: [...items] }, { merge: true });
};

const loadPendingIntents = async (topicId: string): Promise<Map<string, PendingIntent[]>> => {
	const snap = await db().collection(`topics/${topicId}/sessions/0/engagements`).get();
	const result = new Map<string, PendingIntent[]>();
	for (const docSnap of snap.docs) {
		const data = docSnap.data() as { pendingIntents?: PendingIntent[] };
		result.set(docSnap.id, data.pendingIntents ?? []);
	}
	return result;
};

const getDebateTurnsByTopicId = async (topicId: string): Promise<DebateTurn[]> => {
	const snap = await db().doc(`topics/${topicId}/sessions/0`).get();
	if (!snap.exists) return [];
	const data = snap.data() as {
		turns?: Array<{
			id: string;
			turnIndex: number;
			speakerType: string;
			personaId?: string;
			speakerName?: string;
			speakerRole?: string;
			content: string;
			createdAt: Timestamp;
			chapterId?: string;
			fromQueue?: boolean;
			targetPersonaId?: string;
		}>;
	};
	return (data.turns ?? []).map((t) => ({
		id: t.id,
		sessionId: topicId,
		turnIndex: t.turnIndex,
		speakerType: t.speakerType,
		personaId: t.personaId ?? null,
		speakerName: t.speakerName,
		speakerRole: t.speakerRole,
		content: t.content,
		createdAt: t.createdAt?.toDate().toISOString() ?? '',
		chapterId: t.chapterId,
		fromQueue: t.fromQueue,
		targetPersonaId: t.targetPersonaId
	}));
};

const getLatestBelief = (persona: Persona): { content: string; version: number } => {
	const beliefs = persona.beliefs ?? [];
	if (beliefs.length === 0) return { content: '', version: 0 };
	return beliefs.reduce((best, b) => (b.version > best.version ? b : best));
};

const pipelineErrorMessage = (e: PipelineError): string => {
	if ('message' in e) return e.message;
	if ('resource' in e) return `${e.code}: ${e.resource}`;
	return `${e.code}: expected=${e.expected} current=${e.current}`;
};

/** ID が参加ペルソナに存在する場合のみ返す（LLM 由来の不正 ID を無視する） */
const validPersonaId = (
	personaId: string | undefined,
	personas: ReadonlyArray<Persona>
): string | undefined => {
	return personaId && personas.some((p) => p.id === personaId) ? personaId : undefined;
};
