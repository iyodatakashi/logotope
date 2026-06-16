import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { getTopicById, getPersonasByTopicId, getDebateSessionByTopicId } from '../../db/repository.js';
import { FacilitatorAgentService } from '../../agents/facilitator-agent.js';
import { PersonaAgentService } from '../../agents/persona-agent.js';
import { ChapterGeneratorService } from '../chapters/chapter-generator.js';
import {
	resolveDirectAddress,
	decideNextSpeaker,
	speechFromAssessment,
	isHighEngagement,
	hasHighEngagement
} from './speaker-selection.js';
import {
	toEngagementSignal,
	shouldEndChapterEarly,
	chapterTurnCap
} from './chapter-progress.js';
import { shouldEvaluateIntervention } from './intervention-policy.js';
import { restoreDebateState } from './state-restore.js';
import { INTENT_EXPIRY_TURNS } from '../../constants/flow.constants.js';
import type { DebateChapter, SpeakerDecision, PendingIntent } from '../../types/debate.types.js';
import type { PipelineError } from '../../types/common.types.js';
import type { SpeakerAssessment, DebateState } from '../../types/debate.types.js';
import type { DebateTurn } from '../../types/debate.types.js';
import type { PersonaProfile } from '../../types/persona.types.js';
import { DEFAULT_OPTIONS } from '../../constants/debate-orchestrator.constants.js';
import type { OrchestratorOptions } from '../../types/debate.types.js';

// ---- Firestore helpers ----

const db = () => getFirestore();

const personaDocRef = (topicId: string, personaId: string) =>
	db().doc(`topics/${topicId}/personas/${personaId}`);

const isDebateActive = async (topicId: string): Promise<boolean> => {
	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) return false;
	const data = snap.data() as { phase?: number; phaseStatus?: string };
	return data.phase === 5 && data.phaseStatus === 'running';
};

const finalizeTopicIfRunning = async (topicId: string): Promise<boolean> => {
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

const createDebateTurn = async (params: {
	sessionId: string;
	turnIndex: number;
	speakerType: string;
	personaId?: string;
	speakerName?: string;
	speakerRole?: string;
	content: string;
	chapterId?: string;
	speechMode?: 'opinion' | 'fact';
	engagementScore?: number;
	fromQueue?: boolean;
	addressedPersonaId?: string;
	searchUsed?: boolean;
	searchQueries?: string[];
}): Promise<{ id: string }> => {
	const id = nanoid();
	const turn: Record<string, unknown> = {
		id,
		turnIndex: params.turnIndex,
		speakerType: params.speakerType,
		content: params.content,
		createdAt: Timestamp.now(),
	};
	if (params.personaId !== undefined) turn.personaId = params.personaId;
	if (params.speakerName !== undefined) turn.speakerName = params.speakerName;
	if (params.speakerRole !== undefined) turn.speakerRole = params.speakerRole;
	if (params.speechMode !== undefined) turn.speechMode = params.speechMode;
	if (params.engagementScore !== undefined) turn.engagementScore = params.engagementScore;
	if (params.fromQueue) turn.fromQueue = true;
	if (params.chapterId !== undefined) turn.chapterId = params.chapterId;
	if (params.addressedPersonaId !== undefined) turn.addressedPersonaId = params.addressedPersonaId;
	if (params.searchUsed) turn.searchUsed = true;
	if (params.searchQueries?.length) turn.searchQueries = params.searchQueries;
	await db().doc(`topics/${params.sessionId}/sessions/0`).update({
		turns: FieldValue.arrayUnion(turn),
	});
	return { id };
};

const createPersonaBelief = async (params: {
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
		createdAt: Timestamp.now(),
	};
	if (params.changeType !== undefined) belief.changeType = params.changeType;
	if (params.changeSummary !== undefined) belief.changeSummary = params.changeSummary;
	if (params.triggeredByTurnId !== undefined) belief.triggeredByTurnId = params.triggeredByTurnId;
	await personaDocRef(params.topicId, params.personaId).update({
		beliefs: FieldValue.arrayUnion(belief),
	});
	return { id };
};

const createPostDebateComment = async (params: {
	sessionId: string;
	personaId: string;
	content: string;
	sortOrder: number;
}): Promise<{ id: string }> => {
	const id = nanoid();
	await db().doc(`topics/${params.sessionId}/sessions/0`).update({
		postDebateComments: FieldValue.arrayUnion({
			id,
			personaId: params.personaId,
			content: params.content,
			sortOrder: params.sortOrder,
		}),
	});
	return { id };
};

const completeDebateSession = async (id: string, totalTurns: number): Promise<void> => {
	await db().doc(`topics/${id}/sessions/0`).update({ totalTurns, completedAt: Timestamp.now() });
};

const updateCurrentChapterIndex = async (topicId: string, index: number): Promise<void> => {
	await db().doc(`topics/${topicId}/sessions/0`).update({ currentChapterIndex: index });
};

const saveEngagements = async (params: {
	sessionId: string;
	turnIndex: number;
	assessments: Array<{ personaId: string; score: number; mode: 'opinion' | 'fact' | 'none'; intentSummary?: string }>;
}): Promise<void> => {
	for (const assessment of params.assessments) {
		const ref = db().doc(`topics/${params.sessionId}/sessions/0/engagements/${assessment.personaId}`);
		const entry: Record<string, unknown> = { score: assessment.score, mode: assessment.mode };
		if (assessment.intentSummary !== undefined) entry.intentSummary = assessment.intentSummary;
		await ref.set(
			{ history: { [String(params.turnIndex)]: entry } },
			{ mergeFields: [`history.${params.turnIndex}`] }
		);
	}
};

const setPendingIntents = async (
	sessionId: string,
	personaId: string,
	items: ReadonlyArray<PendingIntent>
): Promise<void> => {
	await db().doc(`topics/${sessionId}/sessions/0/engagements/${personaId}`).set(
		{ pendingIntents: [...items] },
		{ merge: true }
	);
};

const loadPendingIntents = async (sessionId: string): Promise<Map<string, PendingIntent[]>> => {
	const snap = await db().collection(`topics/${sessionId}/sessions/0/engagements`).get();
	const result = new Map<string, PendingIntent[]>();
	for (const docSnap of snap.docs) {
		const data = docSnap.data() as { pendingIntents?: PendingIntent[] };
		result.set(docSnap.id, data.pendingIntents ?? []);
	}
	return result;
};

const getDebateTurnsBySessionId = async (sessionId: string): Promise<DebateTurn[]> => {
	const snap = await db().doc(`topics/${sessionId}/sessions/0`).get();
	if (!snap.exists) return [];
	const data = snap.data() as {
		turns?: Array<{
			id: string; turnIndex: number; speakerType: string; personaId?: string;
			speakerName?: string; speakerRole?: string; content: string; createdAt: Timestamp;
			chapterId?: string; fromQueue?: boolean; addressedPersonaId?: string;
		}>;
	};
	return (data.turns ?? []).map((t) => ({
		id: t.id,
		sessionId,
		turnIndex: t.turnIndex,
		speakerType: t.speakerType,
		personaId: t.personaId ?? null,
		speakerName: t.speakerName,
		speakerRole: t.speakerRole,
		content: t.content,
		createdAt: t.createdAt?.toDate().toISOString() ?? '',
		chapterId: t.chapterId,
		fromQueue: t.fromQueue,
		addressedPersonaId: t.addressedPersonaId,
	}));
};

const getPersonaBeliefsByPersonaId = async (
	topicId: string,
	personaId: string
): Promise<Array<{ id: string; version: number; content: string }>> => {
	const snap = await personaDocRef(topicId, personaId).get();
	if (!snap.exists) return [];
	const data = snap.data() as {
		beliefs?: Array<{ id: string; version: number; content: string; triggeredByTurnId?: string }>;
	};
	return data.beliefs ?? [];
};

const getPersonaInterviewByPersonaId = async (
	topicId: string,
	personaId: string
): Promise<{ interviewRecord: string } | null> => {
	const snap = await personaDocRef(topicId, personaId).get();
	if (!snap.exists) return null;
	const data = snap.data() as { interview?: { interviewRecord: string } };
	return data.interview ?? null;
};

// ---- Orchestrator ----

const pipelineErrorMessage = (e: PipelineError): string => {
	if ('message' in e) return e.message;
	if ('resource' in e) return `${e.code}: ${e.resource}`;
	return `${e.code}: expected=${e.expected} current=${e.current}`;
};

/** ID が参加ペルソナに存在する場合のみ返す（LLM 由来の不正 ID を無視する） */
const validPersonaId = (
	personaId: string | undefined,
	personas: ReadonlyArray<PersonaProfile>
): string | undefined => {
	return personaId && personas.some((p) => p.id === personaId) ? personaId : undefined;
};

export class DebateOrchestratorService {
	constructor(
		private facilitator: FacilitatorAgentService = new FacilitatorAgentService(),
		private personaAgent: PersonaAgentService = new PersonaAgentService(),
		private chapterGenerator: ChapterGeneratorService = new ChapterGeneratorService(),
		private options: OrchestratorOptions = DEFAULT_OPTIONS
	) {}

	/** @returns 次章が存在する場合 true（呼び出し元が次章タスクを投入する） */
	async executeChapterTask(topicId: string, chapterIndex: number): Promise<boolean> {
		const sessionId = topicId;

		// 停止ゲート: トピックが討論かつ実行中でなければ何も生成・上書きしない
		if (!(await isDebateActive(topicId))) return false;

		const session = await getDebateSessionByTopicId(topicId);
		if (!session) throw new Error('Session not found');
		if (!session.chapters?.length) throw new Error('Chapters not found');

		// 冪等性: 処理済みの章はスキップする
		if (session.currentChapterIndex !== undefined && session.currentChapterIndex > chapterIndex) {
			return chapterIndex < (session.chapters?.length ?? 0) - 1;
		}

		const { personas, interviewRecords, currentBeliefs, topicTitle } =
			await this.loadSessionContext(topicId);

		const existingTurns = await getDebateTurnsBySessionId(topicId);
		const persistedPendingIntents = await loadPendingIntents(sessionId);
		const state = restoreDebateState({
			turns: existingTurns,
			personas,
			persistedPendingIntents,
			currentBeliefs
		});

		const chapters: DebateChapter[] = (session.chapters ?? []).map((c) => ({
			chapterId: c.chapterId,
			title: c.title,
			focusQuestion: c.focusQuestion,
		}));

		// 第1章の開始: オープニング生成（章立ては generateChapters で事前に保存済み）
		if (chapterIndex === 0 && state.history.length === 0) {
			const openingResult = await this.facilitator.generateOpening(
				topicTitle,
				personas,
				chapters[0]
			);
			if (!openingResult.ok) throw new Error(pipelineErrorMessage(openingResult.error));
			const firstPersonaId = validPersonaId(openingResult.value.firstPersonaId, personas);
			await this.saveFacilitatorTurn(
				sessionId,
				state,
				openingResult.value.content ?? '',
				firstPersonaId,
				chapters[0].chapterId
			);
			state.pendingAddress = firstPersonaId
				? { personaId: firstPersonaId, byFacilitator: true }
				: undefined;
		}

		if (!chapters[chapterIndex]) throw new Error(`Chapter not found: ${chapterIndex}`);
		await updateCurrentChapterIndex(topicId, chapterIndex);

		const outcome = await this.runChapterLoop(
			sessionId,
			topicId,
			personas,
			interviewRecords,
			chapters[chapterIndex],
			state
		);
		if (outcome === 'cancelled') return false;

		// 章終了時に未応答の指名・直接質問が残っていれば応答ターンを1件生成する（+1ターン許容）
		await this.generateUnansweredReply(
			sessionId,
			topicId,
			personas,
			interviewRecords,
			chapters[chapterIndex],
			state
		);

		const isLastChapter = this.options.singleChapterMode || chapterIndex >= chapters.length - 1;
		if (isLastChapter) {
			await this.finalizeDebate(sessionId, topicId, personas, state);
			return false;
		}
		await this.generateChapterTransition(
			sessionId,
			chapters,
			chapterIndex,
			state,
			personas
		);
		return true;
	}

	private async loadSessionContext(topicId: string) {
		const topic = await getTopicById(topicId);
		if (!topic) throw new Error(`Topic not found: ${topicId}`);

		const personas = (await getPersonasByTopicId(topicId)).filter((p) => p.approved);

		const currentBeliefs = new Map<string, { content: string; version: number }>();
		const interviewRecords = new Map<string, string>();

		for (const p of personas) {
			const beliefs = await getPersonaBeliefsByPersonaId(topicId, p.id);
			const latest = beliefs.reduce((best, b) => (b.version > best.version ? b : best), beliefs[0]);
			currentBeliefs.set(p.id, { content: latest?.content ?? '', version: latest?.version ?? 0 });

			const interview = await getPersonaInterviewByPersonaId(topicId, p.id);
			interviewRecords.set(p.id, interview?.interviewRecord ?? '');
		}

		return { topicTitle: topic.title, personas, currentBeliefs, interviewRecords };
	}

	/**
	 * 正準フロー「全員評価」ステップ: 毎ターン全員（直前話者除く）の発言意欲を評価し、
	 * saveEngagements（可視化保存）・活性シグナル記録・キュー失効を行う。
	 * 返り値は当ターンの評価結果（直前話者を除く）。キュー追加は話者決定後に行う（runChapterLoop 内）。
	 */
	private async evaluateEngagement(
		sessionId: string,
		personas: PersonaProfile[],
		interviewRecords: Map<string, string>,
		state: DebateState
	): Promise<SpeakerAssessment[]> {
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
			await setPendingIntents(sessionId, personaId, alive);
		}

		// 直前話者を除く全員の発言意欲を評価する。評価失敗は最低意欲（score 1）として継続する
		const assessTargets = personas.filter((p) => p.id !== state.lastSpeakerId);
		const assessments = await Promise.all(
			assessTargets.map(async (p): Promise<SpeakerAssessment> => {
				const result = await this.personaAgent.assessEngagement(
					p,
					state.currentBeliefs.get(p.id)?.content ?? '',
					interviewRecords.get(p.id) ?? '',
					state.history
				);
				return {
					personaId: p.id,
					score: result.ok ? result.value.score : 1,
					mode: result.ok ? result.value.mode : 'none',
					intentSummary: result.ok ? result.value.intentSummary : undefined
				};
			})
		);

		// 活性シグナルをターンごとに1回だけ記録する
		state.engagementSignals.push(toEngagementSignal(assessments));

		// 評価結果を毎ターン保存する（管理画面での可視化用）
		await saveEngagements({
			sessionId,
			turnIndex: Math.max(0, state.history.length - 1),
			assessments: assessments.map((a) => ({
				personaId: a.personaId,
				score: a.score,
				mode: a.mode,
				intentSummary: a.intentSummary
			}))
		});

		return assessments;
	}

	/**
	 * 正準フロー「章ループ」: 1ターンを「停止ゲート → 全員評価 → 話者決定 → 発言パラメータ取得 → 発言生成・保存 → 状態更新 → 章終了判定」の固定順で進行する。
	 * 話者決定の優先順位: 指名・直接質問 > A（論点ずれ、クールダウン後かつ指名なし時のみ評価）> B（出尽くし、高意欲者なし時のみ評価・クールダウン不問）> キュー > スコア。
	 */
	private async runChapterLoop(
		sessionId: string,
		topicId: string,
		personas: PersonaProfile[],
		interviewRecords: Map<string, string>,
		chapter: DebateChapter,
		state: DebateState
	): Promise<'cancelled' | 'ended'> {
		const { turnsPerChapter, maxTurns } = this.options;
		const personaIds = personas.map((p) => p.id);
		const cap = chapterTurnCap(turnsPerChapter);
		const chapterTurnCount = () =>
			state.history.filter((t) => t.chapterId === chapter.chapterId).length;

		while (chapterTurnCount() < cap && state.history.length < maxTurns) {
			// 各ターン境界でトピックのゲートを確認する（上流再生成でフェーズが戻った場合も停止）
			if (!(await isDebateActive(topicId))) return 'cancelled';

			// 1. 繰り越し指名・直接質問を確認する（BC2: 指名は介入より優先）
			const pendingAddress = state.pendingAddress;
			state.pendingAddress = undefined;
			const directDecision = resolveDirectAddress({
				pendingAddress,
				consecutiveDirectExchanges: state.consecutiveDirectExchanges,
				personaIds
			});

			// 2. 毎ターン全員（直前話者除く）の発言意欲を評価・保存・キュー失効を実行する（BC3）
			const assessments = await this.evaluateEngagement(
				sessionId,
				personas,
				interviewRecords,
				state
			);

			// 3. 論点ずれ介入(A)専用のクールダウン判定
			const lastFacilitatorIdx = state.history.reduce(
				(max, t, i) => (t.speakerType === 'facilitator' ? i : max),
				-1
			);
			const personaTurnsSinceFacilitator = state.history
				.slice(lastFacilitatorIdx + 1)
				.filter((t) => t.speakerType === 'persona').length;
			const driftCooldownPassed = shouldEvaluateIntervention({
				personaTurnsSinceFacilitator,
				cooldownTurns: this.options.interventionCooldown
			});

			// 4. 話者決定: 指名・直接質問 > A > B > キュー > スコア（BC1: B はクールダウン不問 / BC2: 指名を先行評価）
			let decision: SpeakerDecision;
			if (directDecision) {
				decision = directDecision;
			} else if (driftCooldownPassed) {
				const driftDecision = await this.tryTopicDriftIntervention(
					sessionId,
					personas,
					chapter,
					state
				);
				if (driftDecision) {
					decision = driftDecision;
				} else {
					decision =
						(await this.tryStallIntervention(
							sessionId,
							personas,
							chapter,
							state,
							assessments
						)) ??
						decideNextSpeaker({
							assessments,
							pendingIntents: state.pendingIntents,
							silenceMap: state.silenceMap,
							lastSpeakerId: state.lastSpeakerId,
							personaIds
						});
				}
			} else {
				decision =
					(await this.tryStallIntervention(
						sessionId,
						personas,
						chapter,
						state,
						assessments
					)) ??
					decideNextSpeaker({
						assessments,
						pendingIntents: state.pendingIntents,
						silenceMap: state.silenceMap,
						lastSpeakerId: state.lastSpeakerId,
						personaIds
					});
			}

			// 5. 介入ターンで討論全体の上限に達した場合は打ち切る
			if (state.history.length >= maxTurns) break;

			// 6. キュー追加（高意欲・非選択）を発生の都度 write-through
			const triggerTurnIndex = Math.max(0, state.history.length - 1);
			for (const assessment of assessments) {
				if (!isHighEngagement(assessment) || assessment.personaId === decision.personaId) continue;
				const existing = state.pendingIntents.get(assessment.personaId) ?? [];
				const updated = [
					...existing,
					{ triggerTurnIndex, intentSummary: assessment.intentSummary ?? '' }
				];
				state.pendingIntents.set(assessment.personaId, updated);
				await setPendingIntents(sessionId, assessment.personaId, updated);
			}

			// 7. 連続直接質問カウントを一元更新する（direct_address:+1、その他:0）
			state.consecutiveDirectExchanges =
				decision.source === 'direct_address' ? state.consecutiveDirectExchanges + 1 : 0;

			// 8. 発言パラメータを確定する
			const speech = await this.resolveSpeechParams(
				decision.personaId,
				personas,
				interviewRecords,
				state,
				assessments
			);
			decision = {
				...decision,
				mode: speech.mode,
				score: speech.score,
				intentSummary: decision.intentSummary ?? speech.intentSummary
			};

			// 9. 発言生成・保存・状態更新
			const saved = await this.generatePersonaTurn(
				sessionId,
				topicId,
				personas,
				interviewRecords,
				chapter,
				state,
				decision
			);
			if (!saved) return 'cancelled';

			// 10. 章終了判定（早期終了）
			if (
				shouldEndChapterEarly({
					chapterTurnCount: chapterTurnCount(),
					targetTurns: turnsPerChapter,
					engagementSignals: state.engagementSignals
				})
			) {
				return 'ended';
			}
		}
		return 'ended';
	}

	/** B（出尽くし）介入: 高意欲者がいない場合のみ発火し、クールダウンを参照しない（BC1）。介入する場合は指名 decision を返す */
	private async tryStallIntervention(
		sessionId: string,
		personas: PersonaProfile[],
		chapter: DebateChapter,
		state: DebateState,
		assessments: SpeakerAssessment[]
	): Promise<SpeakerDecision | undefined> {
		if (hasHighEngagement(assessments)) return undefined;
		const chapterHistory = state.history.filter((t) => t.chapterId === chapter.chapterId);
		const result = await this.facilitator.evaluateStallIntervention(
			chapterHistory,
			personas,
			state.speakCount,
			chapter
		);
		if (!result.ok) throw new Error(pipelineErrorMessage(result.error));
		if (!result.value.shouldIntervene) return undefined;
		const targetId = validPersonaId(result.value.targetPersonaId, personas);
		await this.saveFacilitatorTurn(sessionId, state, result.value.content ?? '', targetId, chapter.chapterId);
		return targetId ? { personaId: targetId, source: 'nomination' } : undefined;
	}

	/** A（論点ずれ）: 逸脱していれば介入を保存して指名 decision を返す。クールダウン通過後かつ指名なし時のみ評価する */
	private async tryTopicDriftIntervention(
		sessionId: string,
		personas: PersonaProfile[],
		chapter: DebateChapter,
		state: DebateState
	): Promise<SpeakerDecision | undefined> {
		const chapterHistory = state.history.filter((t) => t.chapterId === chapter.chapterId);
		const result = await this.facilitator.evaluateTopicDrift(
			chapterHistory,
			personas,
			state.speakCount,
			chapter
		);
		if (!result.ok) throw new Error(pipelineErrorMessage(result.error));
		if (!result.value.shouldIntervene) return undefined;
		const targetId = validPersonaId(result.value.targetPersonaId, personas);
		if (!targetId) return undefined;
		await this.saveFacilitatorTurn(sessionId, state, result.value.content ?? '', targetId, chapter.chapterId);
		return { personaId: targetId, source: 'nomination' };
	}

	/** 選ばれた話者の発言パラメータ（mode/score・意図）を決める。evaluateEngagement の結果を優先し、評価対象外（直前話者など）のときのみ単独評価へフォールバックする */
	private async resolveSpeechParams(
		speakerId: string,
		personas: PersonaProfile[],
		interviewRecords: Map<string, string>,
		state: DebateState,
		assessments?: ReadonlyArray<SpeakerAssessment>
	): Promise<{ mode?: 'opinion' | 'fact'; score?: number; intentSummary?: string }> {
		const existing = assessments?.find((a) => a.personaId === speakerId);
		if (existing) {
			return { ...speechFromAssessment(existing), intentSummary: existing.intentSummary };
		}
		const persona = personas.find((p) => p.id === speakerId);
		if (!persona) return {};
		const result = await this.personaAgent.assessEngagement(
			persona,
			state.currentBeliefs.get(speakerId)?.content ?? '',
			interviewRecords.get(speakerId) ?? '',
			state.history
		);
		const assessment = result.ok
			? { mode: result.value.mode, score: result.value.score }
			: { mode: 'opinion' as const, score: 2 };
		return {
			...speechFromAssessment(assessment),
			intentSummary: result.ok ? result.value.intentSummary : undefined
		};
	}

	/** 決定に基づきペルソナ発言を生成・保存し、状態（沈黙・キュー・信念・次ターン指名）を更新する */
	private async generatePersonaTurn(
		sessionId: string,
		topicId: string,
		personas: PersonaProfile[],
		interviewRecords: Map<string, string>,
		chapter: DebateChapter,
		state: DebateState,
		decision: SpeakerDecision
	): Promise<boolean> {
		const persona = personas.find((p) => p.id === decision.personaId)!;
		const belief = state.currentBeliefs.get(persona.id) ?? { content: '', version: 0 };
		const interviewRecord = interviewRecords.get(persona.id) ?? '';
		const fromQueue = decision.source === 'queue';

		const chapterHistory = state.history.filter((t) => t.chapterId === chapter.chapterId);
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

		const turnResult = await this.personaAgent.generateTurn(
			persona,
			belief.content,
			interviewRecord,
			{
				chapterHistory,
				chapter,
				mode: decision.mode,
				score: decision.score,
				intentSummary: decision.intentSummary,
				pendingTrigger,
				nominatedByFacilitator: decision.source === 'nomination'
			}
		);
		if (!turnResult.ok) throw new Error(pipelineErrorMessage(turnResult.error));

		// 生成中に討論が停止された場合は、生成済みのセリフを保存せず状態も更新しない
		if (!(await isDebateActive(topicId))) return false;

		// 直接質問先は ID 検証のうえターンに永続化する（自分自身への指定は無視）
		const rawAddressed = turnResult.value.addressedToPersonaId;
		const addressedPersonaId =
			rawAddressed !== persona.id ? validPersonaId(rawAddressed, personas) : undefined;

		const turnIndex = state.history.length;
		const savedTurn = await createDebateTurn({
			sessionId,
			turnIndex,
			speakerType: 'persona',
			personaId: persona.id,
			speakerName: persona.name,
			speakerRole: persona.specificRole,
			content: turnResult.value.content ?? '',
			chapterId: chapter.chapterId,
			speechMode: turnResult.value.speechMode,
			engagementScore: decision.score,
			fromQueue: fromQueue || undefined,
			addressedPersonaId,
			searchUsed: turnResult.value.searchUsed,
			searchQueries: turnResult.value.searchQueries
		});
		state.history.push({
			id: savedTurn.id,
			sessionId,
			turnIndex,
			speakerType: 'persona',
			personaId: persona.id,
			speakerName: persona.name,
			speakerRole: persona.specificRole,
			content: turnResult.value.content,
			createdAt: new Date().toISOString(),
			chapterId: chapter.chapterId,
			fromQueue: fromQueue || undefined,
			addressedPersonaId
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
			await setPendingIntents(sessionId, persona.id, remaining);
		}

		// 信念変化の保存と以後のターンへの反映
		if (turnResult.value.beliefChange) {
			const beliefChange = turnResult.value.beliefChange;
			const newVersion = belief.version + 1;
			await createPersonaBelief({
				topicId,
				personaId: persona.id,
				version: newVersion,
				content: beliefChange.updatedBelief,
				changeType: beliefChange.type,
				changeSummary: beliefChange.summary,
				triggeredByTurnId: savedTurn.id
			});
			state.currentBeliefs.set(persona.id, {
				content: beliefChange.updatedBelief,
				version: newVersion
			});
		}

		// 直接質問の引き継ぎ
		state.pendingAddress = addressedPersonaId
			? { personaId: addressedPersonaId, byFacilitator: false }
			: undefined;

		return true;
	}

	/** 章終了時に未応答の指名・直接質問が残っていれば応答ターンを1件生成する（本体と同じ評価・発言生成の流れ） */
	private async generateUnansweredReply(
		sessionId: string,
		topicId: string,
		personas: PersonaProfile[],
		interviewRecords: Map<string, string>,
		chapter: DebateChapter,
		state: DebateState
	): Promise<void> {
		const pendingAddress = state.pendingAddress;
		state.pendingAddress = undefined;
		if (!pendingAddress) return;

		const decision = resolveDirectAddress({
			pendingAddress,
			consecutiveDirectExchanges: 0,
			personaIds: personas.map((p) => p.id)
		});
		if (!decision) return;

		const assessments = await this.evaluateEngagement(sessionId, personas, interviewRecords, state);
		const speech = await this.resolveSpeechParams(
			decision.personaId,
			personas,
			interviewRecords,
			state,
			assessments
		);
		const enrichedDecision = {
			...decision,
			mode: speech.mode,
			score: speech.score,
			intentSummary: decision.intentSummary ?? speech.intentSummary
		};

		await this.generatePersonaTurn(
			sessionId,
			topicId,
			personas,
			interviewRecords,
			chapter,
			state,
			enrichedDecision
		);
		// 章は終了するため、応答ターン由来の直接質問は引き継がない
		state.pendingAddress = undefined;
	}

	/** ファシリテーター発言を保存し、state.history に追加する */
	private async saveFacilitatorTurn(
		sessionId: string,
		state: DebateState,
		content: string,
		addressedPersonaId?: string,
		chapterId?: string
	): Promise<void> {
		const turnIndex = state.history.length;
		const turn = await createDebateTurn({
			sessionId,
			turnIndex,
			speakerType: 'facilitator',
			speakerName: 'ファシリテーター',
			speakerRole: '',
			content,
			chapterId,
			addressedPersonaId
		});
		state.history.push({
			id: turn.id,
			sessionId,
			turnIndex,
			speakerType: 'facilitator',
			speakerName: 'ファシリテーター',
			speakerRole: '',
			content,
			createdAt: new Date().toISOString(),
			chapterId,
			addressedPersonaId
		});
		state.consecutiveDirectExchanges = 0;
	}

	/** 章遷移: 現章まとめ＋次章導入の2ターンを生成し、導入で最初の発言者を指名する */
	private async generateChapterTransition(
		sessionId: string,
		chapters: DebateChapter[],
		currentChapterIndex: number,
		state: DebateState,
		personas: PersonaProfile[]
	): Promise<void> {
		const chapter = chapters[currentChapterIndex];
		const nextChapter = chapters[currentChapterIndex + 1];
		const recentHistory = state.history.slice(-10);

		const summaryResult = await this.chapterGenerator.generateChapterSummary(recentHistory, chapter);
		if (summaryResult.ok) {
			await this.saveFacilitatorTurn(
				sessionId,
				state,
				summaryResult.value,
				undefined,
				chapter.chapterId
			);
		}

		const introResult = await this.chapterGenerator.generateChapterIntroduction(nextChapter, personas);
		if (introResult.ok) {
			const firstPersonaId = validPersonaId(introResult.value.firstPersonaId, personas);
			await this.saveFacilitatorTurn(
				sessionId,
				state,
				introResult.value.content,
				firstPersonaId,
				nextChapter.chapterId
			);
			state.pendingAddress = firstPersonaId
				? { personaId: firstPersonaId, byFacilitator: true }
				: undefined;
		}
	}

	/** 討論終端: クロージング → 事後コメント → セッション完了 */
	private async finalizeDebate(
		sessionId: string,
		topicId: string,
		personas: PersonaProfile[],
		state: DebateState
	): Promise<void> {
		const finalBeliefs = new Map(
			Array.from(state.currentBeliefs.entries()).map(([id, b]) => [id, b.content])
		);
		const closingResult = await this.facilitator.generateClosing(state.history, finalBeliefs);
		if (!closingResult.ok) throw new Error(pipelineErrorMessage(closingResult.error));
		await this.saveFacilitatorTurn(sessionId, state, closingResult.value ?? '');

		for (let i = 0; i < personas.length; i++) {
			const persona = personas[i];
			const finalBelief = state.currentBeliefs.get(persona.id)?.content ?? '';
			const commentResult = await this.personaAgent.generatePostDebateComment(
				persona,
				finalBelief,
				state.history
			);
			if (commentResult.ok) {
				await createPostDebateComment({
					sessionId,
					personaId: persona.id,
					content: commentResult.value.content,
					sortOrder: i
				});
			}
		}

		await completeDebateSession(sessionId, state.history.length);
		await finalizeTopicIfRunning(topicId);
	}
}
