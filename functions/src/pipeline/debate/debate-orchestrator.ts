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
	generateClosing
} from '../../agents/facilitator-agent.js';
import {
	generateTurn,
	assessEngagement,
	generatePostDebateComment
} from '../../agents/persona-agent.js';
import {
	generateChapterSummary,
	generateChapterIntroduction
} from '../chapters/chapter-generator.js';
import {
	resolvePairConversation,
	decideNextSpeaker,
	isHighEngagement,
	hasHighEngagement
} from './speaker-selection.js';
import { toEngagementSignal, shouldEndChapterEarly, chapterTurnCap } from './chapter-progress.js';
import { shouldEvaluateIntervention } from './intervention-policy.js';
import { restoreDebateState } from './state-restore.js';
import { INTENT_EXPIRY_TURNS } from '../../constants/flow.constants.js';
import type { SpeakerSelection, PendingIntent } from '../../types/debate.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { PipelineError } from '../../types/common.types.js';
import type { Engagement, DebateState } from '../../types/debate.types.js';
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

	// 第1章の開始: オープニング生成（章立ては generateChapters で事前に保存済み）
	if (chapterIndex === 0 && state.history.length === 0) {
		const openingResult = await generateOpening(topicTitle, personas, chapters[0]);
		if (!openingResult.ok) throw new Error(pipelineErrorMessage(openingResult.error));
		const targetPersonaId = validPersonaId(openingResult.value.targetPersonaId, personas);
		await saveFacilitatorTurn(
			topicId,
			state,
			openingResult.value.content ?? '',
			targetPersonaId,
			chapters[0].id
		);
		state.targetPersona = targetPersonaId
			? { personaId: targetPersonaId, targetedBy: 'facilitator' }
			: undefined;
	}

	if (!chapters[chapterIndex]) throw new Error(`Chapter not found: ${chapterIndex}`);
	await updateCurrentChapterIndex(topicId, chapterIndex);

	const chapter = chapters[chapterIndex];
	const { turnsPerChapter, maxTurns, interventionCooldown } = options;
	const cap = chapterTurnCap(turnsPerChapter);
	const engagementSignals: Array<0 | 1> = [];
	const chapterTurnCount = () => state.history.filter((t) => t.chapterId === chapter.id).length;

	while (chapterTurnCount() < cap && state.history.length < maxTurns) {
		const result = await executeTurn(
			topicId,
			personas,
			chapter,
			state,
			interventionCooldown,
			maxTurns
		);
		if (result === 'cancelled') return false;
		if (result === 'limit') break;
		engagementSignals.push(result.engagementSignal);
		if (shouldEndChapterEarly(chapterTurnCount(), turnsPerChapter, engagementSignals)) break;
	}

	// 章終了時に未応答の指名・直接質問が残っていれば応答ターンを1件生成する（+1ターン許容）
	await generateUnansweredReply(topicId, personas, chapter, state);

	const isLastChapter = options.singleChapterMode || chapterIndex >= chapters.length - 1;
	if (isLastChapter) {
		await finalizeDebate(topicId, personas, state);
		return false;
	}
	await generateChapterTransition(topicId, chapters, chapterIndex, state, personas);
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

/** 直近のファシリテーターターン以降のペルソナターン数を返す（論点ずれ介入クールダウン判定用） */
export const countPersonaTurnsSinceFacilitator = (history: readonly DebateTurn[]): number => {
	const lastFacilitatorIdx = history.reduce(
		(max, t, i) => (t.speakerType === 'facilitator' ? i : max),
		-1
	);
	return history.slice(lastFacilitatorIdx + 1).filter((t) => t.speakerType === 'persona').length;
};

/** 高意欲かつ非選択ペルソナのインテントをキューに追加し Firestore に write-through する */
const enqueueHighEngagementIntents = async (
	topicId: string,
	state: DebateState,
	assessments: readonly Engagement[],
	decision: SpeakerSelection,
	triggerTurnIndex: number
): Promise<void> => {
	for (const assessment of assessments) {
		if (!isHighEngagement(assessment) || assessment.personaId === decision.personaId) continue;
		const existing = state.pendingIntents.get(assessment.personaId) ?? [];
		const updated = [
			...existing,
			{ triggerTurnIndex, intentSummary: assessment.intentSummary ?? '' }
		];
		state.pendingIntents.set(assessment.personaId, updated);
		await setPendingIntents(topicId, assessment.personaId, updated);
	}
};

/**
 * 正準フロー「1ターン処理」: 「停止ゲート → 全員評価 → 話者決定 → 発言パラメータ取得 → 発言生成・保存 → 状態更新」の固定順で進行する。
 * 話者決定の優先順位: 指名・直接質問 > A（論点ずれ、クールダウン後かつ指名なし時のみ評価）> B（出尽くし、高意欲者なし時のみ評価・クールダウン不問）> キュー > スコア。
 */
const executeTurn = async (
	topicId: string,
	personas: Persona[],
	chapter: Chapter,
	state: DebateState,
	interventionCooldown: number,
	maxTurns: number
): Promise<'cancelled' | 'limit' | { engagementSignal: 0 | 1 }> => {
	if (!(await isDebateActive(topicId))) return 'cancelled';

	const targetPersona = state.targetPersona;
	state.targetPersona = undefined;
	const personaIds = personas.map((p) => p.id);
	const pairDecision = resolvePairConversation(
		targetPersona,
		state.pairConversationTurns,
		personaIds
	);

	const chapterHistory = state.history.filter((t) => t.chapterId === chapter.id);
	const assessments = await evaluateEngagement(topicId, personas, state);

	const driftCooldownPassed = shouldEvaluateIntervention(
		countPersonaTurnsSinceFacilitator(state.history),
		interventionCooldown
	);

	let decision: SpeakerSelection;
	if (pairDecision) {
		decision = pairDecision;
	} else if (driftCooldownPassed) {
		const driftDecision = await tryTopicDriftIntervention(
			topicId,
			personas,
			chapterHistory,
			chapter,
			state
		);
		if (driftDecision) {
			decision = driftDecision;
		} else {
			decision =
				(await tryStallIntervention(
					topicId,
					personas,
					chapterHistory,
					chapter,
					state,
					assessments
				)) ??
				decideNextSpeaker(
					assessments,
					state.pendingIntents,
					state.silenceMap,
					personaIds,
					state.lastSpeakerId
				);
		}
	} else {
		decision =
			(await tryStallIntervention(
				topicId,
				personas,
				chapterHistory,
				chapter,
				state,
				assessments
			)) ??
			decideNextSpeaker(
				assessments,
				state.pendingIntents,
				state.silenceMap,
				personaIds,
				state.lastSpeakerId
			);
	}

	// 介入ターンで討論全体の上限に達した場合は打ち切る
	if (state.history.length >= maxTurns) return 'limit';

	await enqueueHighEngagementIntents(
		topicId,
		state,
		assessments,
		decision,
		Math.max(0, state.history.length - 1)
	);

	state.pairConversationTurns =
		decision.reason === 'targeted_by_persona' ? state.pairConversationTurns + 1 : 0;

	const speech = await resolveSpeechParams(decision.personaId, personas, state, assessments);

	const saved = await generatePersonaTurn(topicId, personas, chapter, state, decision, speech);
	if (!saved) return 'cancelled';

	return { engagementSignal: toEngagementSignal(assessments) };
};

/**
 * 正準フロー「全員評価」ステップ: 毎ターン全員（直前話者除く）の発言意欲を評価し、
 * saveEngagements（可視化保存）・活性シグナル記録・キュー失効を行う。
 * 返り値は当ターンの評価結果（直前話者を除く）。キュー追加は話者決定後に行う（runChapterLoop 内）。
 */
const evaluateEngagement = async (
	topicId: string,
	personas: Persona[],
	state: DebateState
): Promise<Engagement[]> => {
	// キュー失効（トリガーから INTENT_EXPIRY_TURNS 超過）を毎ターン適用し write-through
	for (const [personaId, items] of state.pendingIntents.entries()) {
		const alive = items.filter(
			(item) => state.history.length - item.triggerTurnIndex <= INTENT_EXPIRY_TURNS
		);
		if (alive.length === items.length) continue;
		if (alive.length === 0) {
			state.pendingIntents.delete(personaId);
		} else {
			state.pendingIntents.set(personaId, alive);
		}
		await setPendingIntents(topicId, personaId, alive);
	}

	// 直前話者を除く全員の発言意欲を評価する。評価失敗は最低意欲（score 1）として継続する
	const assessTargets = personas.filter((p) => p.id !== state.lastSpeakerId);
	const assessments = await Promise.all(
		assessTargets.map(async (p): Promise<Engagement> => {
			const result = await assessEngagement(p, state.history);
			return result.ok ? result.value : { personaId: p.id, score: 1, mode: 'none' };
		})
	);

	// 評価結果を毎ターン保存する（管理画面での可視化用）
	await saveEngagements({
		topicId,
		turnIndex: Math.max(0, state.history.length - 1),
		assessments: assessments.map((a) => ({
			personaId: a.personaId,
			score: a.score,
			mode: a.mode,
			intentSummary: a.intentSummary
		}))
	});

	return assessments;
};

/** B（出尽くし）介入: 高意欲者がいない場合のみ発火し、クールダウンを参照しない（BC1）。介入する場合は指名 decision を返す */
const tryStallIntervention = async (
	topicId: string,
	personas: Persona[],
	chapterHistory: readonly DebateTurn[],
	chapter: Chapter,
	state: DebateState,
	assessments: Engagement[]
): Promise<SpeakerSelection | undefined> => {
	if (hasHighEngagement(assessments)) return undefined;
	const result = await evaluateStallIntervention(
		chapterHistory as DebateTurn[],
		personas,
		state.speakCount,
		chapter
	);
	if (!result.ok) throw new Error(pipelineErrorMessage(result.error));
	if (!result.value.content) return undefined;
	const targetId = validPersonaId(result.value.targetPersonaId, personas);
	return persistInterventionTurn(topicId, state, result.value.content, targetId, chapter.id);
};

/** ファシリテーター介入ターンを保存し、ターゲットがあれば SpeakerSelection を返す */
export const persistInterventionTurn = async (
	topicId: string,
	state: DebateState,
	content: string,
	targetPersonaId: string | undefined,
	chapterId: string
): Promise<SpeakerSelection | undefined> => {
	await saveFacilitatorTurn(topicId, state, content, targetPersonaId, chapterId);
	return targetPersonaId
		? { personaId: targetPersonaId, reason: 'targeted_by_facilitator' }
		: undefined;
};

/** A（論点ずれ）: 逸脱していれば介入を保存して指名 decision を返す。クールダウン通過後かつ指名なし時のみ評価する */
const tryTopicDriftIntervention = async (
	topicId: string,
	personas: Persona[],
	chapterHistory: readonly DebateTurn[],
	chapter: Chapter,
	state: DebateState
): Promise<SpeakerSelection | undefined> => {
	const result = await evaluateTopicDrift(
		chapterHistory as DebateTurn[],
		personas,
		state.speakCount,
		chapter
	);
	if (!result.ok) throw new Error(pipelineErrorMessage(result.error));
	if (!result.value.content) return undefined;
	const targetId = validPersonaId(result.value.targetPersonaId, personas);
	if (!targetId) return undefined;
	return persistInterventionTurn(topicId, state, result.value.content, targetId, chapter.id);
};

/** 選ばれた話者の発言パラメータ（mode/score・意図）を決める。evaluateEngagement の結果を優先し、評価対象外（直前話者など）のときのみ単独評価へフォールバックする */
const resolveSpeechParams = async (
	speakerId: string,
	personas: Persona[],
	state: DebateState,
	assessments?: ReadonlyArray<Engagement>
): Promise<Engagement> => {
	const existing = assessments?.find((a) => a.personaId === speakerId);
	if (existing) {
		return existing;
	}
	const persona = personas.find((p) => p.id === speakerId);
	if (!persona) return { personaId: speakerId, mode: 'opinion', score: 2 };
	const result = await assessEngagement(persona, state.history);
	if (!result.ok) return { personaId: speakerId, mode: 'opinion', score: 2 };
	return result.value;
};

/** 決定に基づきペルソナ発言を生成・保存し、状態（沈黙・キュー・信念・次ターン指名）を更新する */
const generatePersonaTurn = async (
	topicId: string,
	personas: Persona[],
	chapter: Chapter,
	state: DebateState,
	decision: SpeakerSelection,
	speech: Engagement
): Promise<boolean> => {
	const persona = personas.find((p) => p.id === decision.personaId)!;
	const belief = getLatestBelief(persona);
	const fromQueue = decision.reason === 'queue';

	const chapterHistory = state.history.filter((t) => t.chapterId === chapter.id);
	const pendingEntries = state.pendingIntents.get(persona.id);
	let pendingTrigger: { speakerName: string; content: string } | undefined;
	if (pendingEntries && pendingEntries.length > 0) {
		const triggerTurn = state.history.find(
			(t) => t.turnIndex === pendingEntries[0].triggerTurnIndex
		);
		pendingTrigger = triggerTurn
			? { speakerName: triggerTurn.speakerName ?? '', content: triggerTurn.content }
			: undefined;
	}

	const turnResult = await generateTurn(
		persona,
		{
			chapterHistory,
			chapter,
			pendingTrigger,
			targetedBy:
				decision.reason === 'targeted_by_facilitator' || decision.reason === 'targeted_by_persona'
					? decision.reason === 'targeted_by_facilitator'
						? 'facilitator'
						: 'persona'
					: undefined
		},
		{ ...speech, intentSummary: decision.intentSummary ?? speech.intentSummary }
	);
	if (!turnResult.ok) throw new Error(pipelineErrorMessage(turnResult.error));

	// 生成中に討論が停止された場合は、生成済みのセリフを保存せず状態も更新しない
	if (!(await isDebateActive(topicId))) return false;

	// 直接質問先は ID 検証のうえターンに永続化する（自分自身への指定は無視）
	const rawTarget = turnResult.value.targetPersonaId;
	const targetPersonaId =
		rawTarget !== persona.id ? validPersonaId(rawTarget, personas) : undefined;

	const turnIndex = state.history.length;
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
	state.history.push({
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

	for (const p of personas) {
		state.silenceMap.set(p.id, p.id === persona.id ? 0 : (state.silenceMap.get(p.id) ?? 0) + 1);
	}
	state.speakCount.set(persona.id, (state.speakCount.get(persona.id) ?? 0) + 1);
	state.lastSpeakerId = persona.id;

	// 発言後: そのペルソナの最古キューエントリを1件消費し write-through
	if (pendingEntries && pendingEntries.length > 0) {
		const remaining = pendingEntries.slice(1);
		if (remaining.length === 0) {
			state.pendingIntents.delete(persona.id);
		} else {
			state.pendingIntents.set(persona.id, remaining);
		}
		await setPendingIntents(topicId, persona.id, remaining);
	}

	// 信念変化の保存と以後のターンへの反映
	if (turnResult.value.beliefChange) {
		const beliefChange = turnResult.value.beliefChange;
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
	}

	// ペルソナ間の指名を引き継ぐ
	state.targetPersona = targetPersonaId
		? { personaId: targetPersonaId, targetedBy: 'persona' }
		: undefined;

	return true;
};

/** 章終了時に未応答の指名・直接質問が残っていれば応答ターンを1件生成する（本体と同じ評価・発言生成の流れ） */
const generateUnansweredReply = async (
	topicId: string,
	personas: Persona[],
	chapter: Chapter,
	state: DebateState
): Promise<void> => {
	const targetPersona = state.targetPersona;
	state.targetPersona = undefined;
	if (!targetPersona) return;

	const decision = resolvePairConversation(
		targetPersona,
		0,
		personas.map((p) => p.id)
	);
	if (!decision) return;

	const assessments = await evaluateEngagement(topicId, personas, state);
	const speech = await resolveSpeechParams(decision.personaId, personas, state, assessments);
	await generatePersonaTurn(topicId, personas, chapter, state, decision, speech);
	// 章は終了するため、応答ターン由来の指名は引き継がない
	state.targetPersona = undefined;
};

/** ファシリテーター発言を保存し、state.history に追加する */
const saveFacilitatorTurn = async (
	topicId: string,
	state: DebateState,
	content: string,
	targetPersonaId?: string,
	chapterId?: string
): Promise<void> => {
	const turnIndex = state.history.length;
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
	state.history.push({
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
};

/** 章遷移: 現章まとめ＋次章導入の2ターンを生成し、導入で最初の発言者を指名する */
const generateChapterTransition = async (
	topicId: string,
	chapters: Chapter[],
	currentChapterIndex: number,
	state: DebateState,
	personas: Persona[]
): Promise<void> => {
	const chapter = chapters[currentChapterIndex];
	const nextChapter = chapters[currentChapterIndex + 1];
	const recentHistory = state.history.slice(-10);

	const summaryResult = await generateChapterSummary(recentHistory, chapter);
	if (summaryResult.ok) {
		await saveFacilitatorTurn(topicId, state, summaryResult.value, undefined, chapter.id);
	}

	const introResult = await generateChapterIntroduction(nextChapter, personas);
	if (introResult.ok) {
		const targetPersonaId = validPersonaId(introResult.value.targetPersonaId, personas);
		await saveFacilitatorTurn(
			topicId,
			state,
			introResult.value.content ?? '',
			targetPersonaId,
			nextChapter.id
		);
		state.targetPersona = targetPersonaId
			? { personaId: targetPersonaId, targetedBy: 'facilitator' }
			: undefined;
	}
};

/** 討論終端: クロージング → 事後コメント → セッション完了 */
const finalizeDebate = async (
	topicId: string,
	personas: Persona[],
	state: DebateState
): Promise<void> => {
	const finalBeliefs = new Map(personas.map((p) => [p.id, getLatestBelief(p).content]));
	const closingResult = await generateClosing(state.history, finalBeliefs);
	if (!closingResult.ok) throw new Error(pipelineErrorMessage(closingResult.error));
	await saveFacilitatorTurn(topicId, state, closingResult.value ?? '');

	for (let i = 0; i < personas.length; i++) {
		const persona = personas[i];
		const finalBelief = getLatestBelief(persona).content;
		const commentResult = await generatePostDebateComment(persona, finalBelief, state.history);
		if (commentResult.ok) {
			await createPostDebateComment({
				topicId,
				personaId: persona.id,
				content: commentResult.value.content,
				sortOrder: i
			});
		}
	}

	await completeDebateSession(topicId, state.history.length);
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

const updateCurrentChapterIndex = async (topicId: string, index: number): Promise<void> => {
	await db().doc(`topics/${topicId}/sessions/0`).update({ currentChapterIndex: index });
};

const saveEngagements = async (params: {
	topicId: string;
	turnIndex: number;
	assessments: Array<{
		personaId: string;
		score: number;
		mode: 'opinion' | 'fact' | 'none';
		intentSummary?: string;
	}>;
}): Promise<void> => {
	for (const assessment of params.assessments) {
		const ref = db().doc(`topics/${params.topicId}/sessions/0/engagements/${assessment.personaId}`);
		const entry: Record<string, unknown> = { score: assessment.score, mode: assessment.mode };
		if (assessment.intentSummary !== undefined) entry.intentSummary = assessment.intentSummary;
		await ref.set(
			{ history: { [String(params.turnIndex)]: entry } },
			{ mergeFields: [`history.${params.turnIndex}`] }
		);
	}
};

const setPendingIntents = async (
	topicId: string,
	personaId: string,
	items: ReadonlyArray<PendingIntent>
): Promise<void> => {
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
