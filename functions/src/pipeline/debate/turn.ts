import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { nanoid } from 'nanoid';
import { generateTurn } from '../../agents/persona-agent.js';
import { verifyAndReviseDraft } from './inline-fact-check.js';
import { getActiveAgendaItem } from './agenda.js';
import { getTopicContext } from '../topics/topic-context.js';
import { isDebateActive } from './debate-lifecycle.js';
import { setPendingTurn, updatePendingTurnStatus, clearPendingTurn } from './pending-turn.js';
import { pipelineErrorMessage, validPersonaId } from './utils.js';
import { FACILITATOR_NAME } from '../../constants/debate.constants.js';
import { currentDateString } from '../../utils/prompt-formatters.js';
import type {
	DebateState,
	SpeakerSelection,
	QueuedIntent,
	Engagement
} from '../../types/debate.types.js';
import type {
	DebateTurn,
	AppendTurnInput,
	AppendResult,
	NewTurnFields,
	ProgressPatch,
	TurnGenerationContext
} from '../../types/turn.types.js';
import type { FactCheckContext } from '../../types/fact-check.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { Persona } from '../../types/persona.types.js';

const db = () => getFirestore();

/** NewTurnFields から永続化用のターンレコード（undefined フィールドを除外）を構築する */
const buildTurnRecord = (id: string, turn: NewTurnFields): Record<string, unknown> => {
	const record: Record<string, unknown> = {
		id,
		speakerType: turn.speakerType,
		content: turn.content,
		createdAt: Timestamp.now()
	};
	if (turn.personaId !== undefined) record.personaId = turn.personaId;
	if (turn.speechMode !== undefined) record.speechMode = turn.speechMode;
	if (turn.engagementScore !== undefined) record.engagementScore = turn.engagementScore;
	if (turn.fromQueue) record.fromQueue = true;
	if (turn.targetPersonaId !== undefined) record.targetPersonaId = turn.targetPersonaId;
	if (turn.targetedBy !== undefined) record.targetedBy = turn.targetedBy;
	if (turn.searchUsed) record.searchUsed = true;
	if (turn.searchQueries?.length) record.searchQueries = turn.searchQueries;
	// 補正トレース（検証状態・補正有無・適用指摘・補正前ドラフト）を発言に co-located で永続化（4.2）
	if (turn.factCheck !== undefined) record.factCheck = turn.factCheck;
	// 反応評価中マーク。末尾評価対象の persona ターンにのみ付与し、完了で削除する（2.3/2.4）
	if (turn.status !== undefined) record.status = turn.status;
	return record;
};

/**
 * 章ローカル `turns.length === expectedTurnIndex` のときだけ1ターン追記し、runId 世代照合と
 * 進捗（quietStreak / agendaItemStatuses）更新を同一トランザクションで行う冪等追記。
 * 不一致時は例外を投げず rejected を返して副作用を残さない。
 */
export const addTurn = async (input: AppendTurnInput): Promise<AppendResult> => {
	const { topicId, chapterId, expectedTurnIndex, turn, runId, progressPatch } = input;
	const chapterRef = db().doc(`topics/${topicId}/chapters/${chapterId}`);
	const topicRef = db().doc(`topics/${topicId}`);
	// pendingTurn 経路は生成開始時に発番した id を移送する。未指定時のみ従来どおり発番する。
	const id = input.id ?? nanoid();
	return db().runTransaction(async (tx) => {
		// runId がペイロード・topic doc の双方にある場合のみ世代照合する（後方互換）
		if (runId) {
			const topicSnap = await tx.get(topicRef);
			const topicData = topicSnap.data() as { runId?: string } | undefined;
			if (topicData?.runId && topicData.runId !== runId) {
				return { status: 'rejected', reason: 'generation_mismatch' };
			}
		}
		const chapterSnap = await tx.get(chapterRef);
		const data = chapterSnap.data() as { turns?: DebateTurn[] } | undefined;
		const currentTurns = data?.turns ?? [];
		if (currentTurns.length !== expectedTurnIndex) {
			return { status: 'rejected', reason: 'index_mismatch' };
		}
		const update: Record<string, unknown> = {
			turns: [...currentTurns, buildTurnRecord(id, turn)],
			// 生成中→確定の原子的移送：確定と同一トランザクションで pendingTurn を消す（2.8）
			pendingTurn: FieldValue.delete()
		};
		if (progressPatch?.quietStreak !== undefined) {
			update.quietStreak = progressPatch.quietStreak;
		}
		if (progressPatch?.agendaItemStatuses !== undefined) {
			update.agendaItemStatuses = progressPatch.agendaItemStatuses;
		}
		tx.update(chapterRef, update);
		return { status: 'committed', id };
	});
};

/**
 * ファシリテーター発言を期待位置照合のうえ保存し、committed なら state.turns を更新する。
 * 期待位置は章ローカル長 `state.turns.length - chapterTurnStartIndex`。追記結果をそのまま返す。
 */
export const generateFacilitatorTurn = async ({
	topicId,
	state,
	content,
	targetPersonaId,
	chapterId,
	chapterTurnStartIndex = 0,
	progressPatch
}: {
	topicId: string;
	state: DebateState;
	content: string;
	targetPersonaId?: string;
	chapterId: string;
	chapterTurnStartIndex?: number;
	progressPatch?: ProgressPatch;
}): Promise<AppendResult> => {
	const result = await addTurn({
		topicId,
		chapterId,
		expectedTurnIndex: state.turns.length - chapterTurnStartIndex,
		turn: {
			speakerType: 'facilitator',
			content,
			targetPersonaId,
			targetedBy: targetPersonaId ? 'facilitator' : undefined,
			// ファシリテーターターンも末尾評価の対象。確定と同時に評価中とし、end-eval 完了でクリアされる（1.5/1.6）
			status: 'evaluating'
		},
		runId: state.runId,
		progressPatch
	});
	if (result.status !== 'committed') return result;
	state.turns.push({
		id: result.id,
		speakerType: 'facilitator',
		content,
		createdAt: Timestamp.now(),
		targetPersonaId,
		targetedBy: targetPersonaId ? 'facilitator' : undefined
	});
	state.lastSpeakerId = undefined;
	return result;
};

/**
 * キュー由来の発言意図から、トリガーとなったターンの話者名・内容を整形する。
 * 対象キューが空、またはトリガーターンが見つからない場合は undefined を返す。
 */
const buildQueuedTrigger = (
	queuedEntries: QueuedIntent[] | undefined,
	turns: DebateTurn[],
	personas: Persona[]
): { speakerName: string; content: string } | undefined => {
	if (!queuedEntries || queuedEntries.length === 0) return undefined;
	const triggerTurn = turns.find((turn) => turn.id === queuedEntries[0].triggerTurnId);
	if (!triggerTurn) return undefined;
	const triggerPersona = triggerTurn.personaId
		? personas.find((persona) => persona.id === triggerTurn.personaId)
		: undefined;
	return {
		speakerName: triggerPersona ? triggerPersona.name : FACILITATOR_NAME,
		content: triggerTurn.content
	};
};

export type PersonaTurnCommit = {
	turnId: string;
	personaId: string;
	targetPersonaId: string | undefined;
	queuedEntries: QueuedIntent[] | undefined;
	fromQueue: boolean;
};

/**
 * generatePersonaTurn の実行結果。committed は確定情報を、rejected は addTurn の棄却理由
 * （generation_mismatch / index_mismatch）を保持し、skipped は討論停止による中断を表す。
 * 棄却理由を null へ潰さず呼び出し元まで伝播させる（R9.2）。
 */
export type PersonaTurnOutcome =
	| ({ status: 'committed' } & PersonaTurnCommit)
	| Extract<AppendResult, { status: 'rejected' }>
	| { status: 'skipped' };

/** 決定に基づきペルソナ発言を生成・保存する。討論停止時は skipped、追記棄却時は rejected を返す */
export const generatePersonaTurn = async ({
	topicId,
	topicTitle = '',
	personas,
	chapter,
	state,
	speakerSelection,
	engagement,
	chapterTurnStartIndex = 0,
	progressPatch
}: {
	topicId: string;
	topicTitle?: string;
	personas: Persona[];
	chapter: Chapter;
	state: DebateState;
	speakerSelection: SpeakerSelection;
	engagement: Engagement;
	chapterTurnStartIndex?: number;
	progressPatch?: ProgressPatch;
}): Promise<PersonaTurnOutcome> => {
	const persona = personas.find((candidate) => candidate.id === speakerSelection.personaId)!;
	const fromQueue = speakerSelection.reason === 'queue';

	const chapterTurns = state.turns.slice(chapterTurnStartIndex);
	const queuedEntries = state.queuedIntents.get(persona.id);
	const queuedTrigger = buildQueuedTrigger(queuedEntries, state.turns, personas);

	const otherPersonas = personas
		.filter((otherPersona) => otherPersona.id !== persona.id)
		.map((otherPersona) => ({ id: otherPersona.id, name: otherPersona.name }));

	// ファシリテーターが直近に提示した（introduced）論点を、発言者が踏まえられるよう渡す
	const activeAgendaItem = getActiveAgendaItem(state);

	// 事実基盤（共通前提）はサーバ権威の getTopicContext で供給し、全ペルソナへ同一値を渡す（R8.1/9.3）。
	const { factBase } = await getTopicContext(topicId);

	// 補正モジュールが再生成時に再利用できるよう、生成文脈とエンゲージメントを一度組み立てる
	const generationContext: TurnGenerationContext = {
		chapterTurns,
		chapter,
		activeAgendaItem,
		queuedTrigger,
		targetedBy:
			speakerSelection.reason === 'targeted_by_facilitator' ||
			speakerSelection.reason === 'targeted_by_persona'
				? speakerSelection.reason === 'targeted_by_facilitator'
					? 'facilitator'
					: 'persona'
				: undefined,
		otherPersonas,
		factBase
	};
	const turnEngagement: Engagement = {
		...engagement,
		intentSummary: speakerSelection.intentSummary ?? engagement.intentSummary
	};

	// 話者確定・本文生成開始で pendingTurn を generating として先行作成する（発番 id をコミットへ移送・2.1）
	const expectedTurnIndex = state.turns.length - chapterTurnStartIndex;
	const pendingTurnId = nanoid();
	await setPendingTurn({
		topicId,
		chapterId: chapter.id,
		pendingTurn: {
			id: pendingTurnId,
			personaId: persona.id,
			expectedTurnIndex,
			status: 'generating'
		}
	});

	try {
		// まずドラフトを生成する
		const turnResult = await generateTurn(persona, generationContext, turnEngagement, personas);
		if (!turnResult.ok) throw new Error(pipelineErrorMessage(turnResult.error));

		// 生成中に討論が停止された場合は、ドラフトを検証・保存せず未確定 pendingTurn を消す（3.4）
		if (!(await isDebateActive(topicId))) {
			await clearPendingTurn({ topicId, chapterId: chapter.id, id: pendingTurnId });
			return { status: 'skipped' };
		}

		// ファクトチェック開始で pendingTurn を fact-checking に更新する（2.2）
		await updatePendingTurnStatus({
			topicId,
			chapterId: chapter.id,
			id: pendingTurnId,
			status: 'fact-checking'
		});

		// 討論継続中はインライン検証・補正を経てから正式登録する（誤った発言の伝播を防ぐ）
		const factCheckContext: FactCheckContext = {
			topicTitle,
			chapterTitle: chapter.title,
			discussionScope: activeAgendaItem ?? chapter.title,
			currentDate: currentDateString()
		};
		const { reply, trace } = await verifyAndReviseDraft({
			draft: turnResult.value,
			persona,
			context: generationContext,
			factCheckContext,
			engagement: turnEngagement,
			personas
		});

		// 採用された発言（補正後 or 原ドラフト）で指名先の再検証・発言モード確定を行う（3.3）
		const rawTarget = reply.targetPersonaId;
		const targetPersonaId =
			rawTarget !== persona.id ? validPersonaId(rawTarget, personas) : undefined;

		// question モードで targetPersonaId が設定されなかった場合は opinion にフォールバック
		const effectiveSpeechMode =
			reply.speechMode === 'question' && !targetPersonaId ? 'opinion' : reply.speechMode;

		const addTurnResult = await addTurn({
			topicId,
			chapterId: chapter.id,
			expectedTurnIndex,
			// pendingTurn で発番した id を確定ターンへ移送する（addTurn は同一tx で pendingTurn を削除）
			id: pendingTurnId,
			turn: {
				speakerType: 'persona',
				personaId: persona.id,
				content: reply.content,
				speechMode: effectiveSpeechMode,
				engagementScore: engagement.score,
				fromQueue: fromQueue || undefined,
				targetPersonaId,
				targetedBy: targetPersonaId ? 'persona' : undefined,
				searchUsed: reply.searchUsed,
				searchQueries: reply.searchQueries,
				factCheck: trace,
				// 確定と同時に末尾評価対象としてマークする。end-eval 完了でクリアされる（2.3/2.4）
				status: 'evaluating'
			},
			runId: state.runId,
			progressPatch
		});
		// 追記棄却（frontier 敗者・世代不一致）は自分の pendingTurn を消して理由を伝播する（3.6・R9.2）
		if (addTurnResult.status !== 'committed') {
			await clearPendingTurn({ topicId, chapterId: chapter.id, id: pendingTurnId });
			return addTurnResult;
		}
		const { id: turnId } = addTurnResult;
		state.turns.push({
			id: turnId,
			speakerType: 'persona',
			personaId: persona.id,
			content: reply.content,
			createdAt: Timestamp.now(),
			fromQueue: fromQueue || undefined,
			targetPersonaId,
			targetedBy: targetPersonaId ? 'persona' : undefined,
			factCheck: trace
		});

		return {
			status: 'committed',
			turnId,
			personaId: persona.id,
			targetPersonaId,
			queuedEntries,
			fromQueue
		};
	} catch (err) {
		// 生成/検証失敗・中断で未確定 pendingTurn を残さない（3.5）
		await clearPendingTurn({ topicId, chapterId: chapter.id, id: pendingTurnId });
		throw err;
	}
};
