import { Timestamp } from 'firebase-admin/firestore';
import { evaluateTopicDrift, evaluateStallIntervention } from '../../agents/facilitator-agent.js';
import { hasHighEngagement } from './speaker-selection.js';
import { addQueuedIntents } from './queued-intents.js';
import { addTurn } from './turn.js';
import { pipelineErrorMessage, validPersonaId } from './utils.js';
import type {
	DebateState,
	SpeakerSelection,
	Engagement,
	DebateTurn,
	ProgressPatch
} from '../../types/debate.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { Persona } from '../../types/persona.types.js';

/** クールダウン経過で true（論点ずれ介入(A)専用。B は高意欲者なしを gate とし、クールダウン不問） */
export const shouldEvaluateIntervention = (
	personaTurnsSinceFacilitator: number,
	cooldownTurns: number
): boolean => personaTurnsSinceFacilitator >= cooldownTurns;

/** 直近のファシリテーターターン以降のペルソナターン数を返す（論点ずれ介入クールダウン判定用） */
export const countPersonaTurnsSinceFacilitator = (history: readonly DebateTurn[]): number => {
	const lastFacilitatorIdx = history.reduce(
		(max, t, i) => (t.speakerType === 'facilitator' ? i : max),
		-1
	);
	return history.slice(lastFacilitatorIdx + 1).filter((t) => t.speakerType === 'persona').length;
};

/**
 * ファシリテーター介入ターンを期待位置照合のうえ保存する。committed なら state.turns を更新し、
 * ターゲットがあれば SpeakerSelection を返す。期待位置不一致・世代ミスマッチ時は undefined を返す。
 */
export const persistInterventionTurn = async ({
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
	targetPersonaId: string | undefined;
	chapterId: string;
	chapterTurnStartIndex?: number;
	progressPatch?: ProgressPatch;
}): Promise<SpeakerSelection | undefined> => {
	const result = await addTurn({
		topicId,
		chapterId,
		expectedTurnIndex: state.turns.length - chapterTurnStartIndex,
		turn: {
			speakerType: 'facilitator',
			content,
			targetPersonaId,
			targetedBy: targetPersonaId ? 'facilitator' : undefined
		},
		runId: state.runId,
		progressPatch
	});
	if (result.status !== 'committed') return undefined;
	state.turns.push({
		id: result.id,
		speakerType: 'facilitator',
		content,
		createdAt: Timestamp.now(),
		targetPersonaId,
		targetedBy: targetPersonaId ? 'facilitator' : undefined
	});
	state.lastSpeakerId = undefined;
	return targetPersonaId
		? { personaId: targetPersonaId, reason: 'targeted_by_facilitator' }
		: undefined;
};

/** 介入が必要か評価し、発火した場合は state を更新して true を返す */
export const tryIntervention = async ({
	topicId,
	personas,
	chapter,
	chapterId,
	state,
	engagements,
	interventionCooldown,
	chapterTurns,
	chapterTurnStartIndex = 0,
	progressPatch
}: {
	topicId: string;
	personas: Persona[];
	chapter: Chapter;
	chapterId: string;
	state: DebateState;
	engagements: Engagement[];
	interventionCooldown: number;
	chapterTurns?: DebateTurn[];
	chapterTurnStartIndex?: number;
	progressPatch?: ProgressPatch;
}): Promise<boolean> => {
	// 介入判定の対象とする発言履歴（呼び出し側が章ローカルのターン列を渡す。未指定なら全ターン）
	const currentChapterTurns = chapterTurns ?? state.turns;
	// いずれかの介入が発火したらここに { 発言内容, 指名先, 提示する論点index } が入る
	let intervention:
		| { content: string; targetPersonaId?: string; selectedDiscussionPointIndex?: number }
		| undefined;

	// まだ消化しきれていない（addressed でない）論点。介入時にファシリテーターへ提示候補として渡す
	const unaddressedDiscussionPoints = state.discussionPoints
		.filter((p) => p.status !== 'addressed')
		.map((p) => p.point);

	// クールダウン（前回ファシリテーター発言から十分なペルソナ発言が経過）を満たすときだけ介入を評価する
	if (
		shouldEvaluateIntervention(
			countPersonaTurnsSinceFacilitator(currentChapterTurns),
			interventionCooldown
		)
	) {
		// 高意欲者（score >= STALL_INTERVENTION_THRESHOLD_SCORE）がいる場合、論点投入を抑止して
		// 明確な逸脱のみ検出させる（未完了論点リストを渡さないことで option 2 を封じる）
		const driftPoints = hasHighEngagement(engagements) ? [] : unaddressedDiscussionPoints;
		// 介入は2段カスケード: まず論点ずれ介入を試し、起きなければ出尽くし(スタール)介入を試す
		intervention = await tryTopicDriftIntervention({
			personas,
			chapter,
			chapterTurns: currentChapterTurns,
			state,
			unaddressedDiscussionPoints: driftPoints
		});
		if (!intervention) {
			intervention = await tryStallIntervention({
				personas,
				chapter,
				chapterTurns: currentChapterTurns,
				state,
				engagements,
				unaddressedDiscussionPoints
			});
		}
	}
	if (!intervention) return false;

	// 介入が論点を1つ提示した場合、その論点を introduced（提示済み）に更新する
	if (
		intervention.selectedDiscussionPointIndex !== undefined &&
		intervention.selectedDiscussionPointIndex >= 0 &&
		intervention.selectedDiscussionPointIndex < unaddressedDiscussionPoints.length
	) {
		const introducedPoint = unaddressedDiscussionPoints[intervention.selectedDiscussionPointIndex];
		const target = state.discussionPoints.find((p) => p.point === introducedPoint);
		if (target) target.status = 'introduced';
	}

	// 介入ターンの直前時点で意欲の高かった他ペルソナの意図をキューに積んでおく
	// （speakerSelection.personaId='' は「除外する話者なし」を意味する）
	await addQueuedIntents({
		topicId,
		chapterId,
		state,
		engagements,
		speakerSelection: { personaId: '', reason: 'score' },
		triggerTurnId: state.turns[state.turns.length - 1]?.id ?? ''
	});
	// 介入発言を1ターンとして永続化する
	await persistInterventionTurn({
		topicId,
		state,
		content: intervention.content,
		targetPersonaId: intervention.targetPersonaId,
		chapterId: chapter.id,
		chapterTurnStartIndex,
		progressPatch
	});
	return true;
};

/** 論点ずれチェック: 逸脱していれば介入内容を返す。クールダウン通過後かつ指名なし時のみ評価する */
const tryTopicDriftIntervention = async ({
	personas,
	chapter,
	chapterTurns,
	state,
	unaddressedDiscussionPoints
}: {
	personas: Persona[];
	chapter: Chapter;
	chapterTurns: DebateTurn[];
	state: DebateState;
	unaddressedDiscussionPoints: string[];
}): Promise<
	{ content: string; targetPersonaId: string; selectedDiscussionPointIndex?: number } | undefined
> => {
	const result = await evaluateTopicDrift(
		chapterTurns,
		personas,
		state.speakCount,
		chapter,
		unaddressedDiscussionPoints.length > 0 ? unaddressedDiscussionPoints : undefined
	);
	if (!result.ok) throw new Error(pipelineErrorMessage(result.error));
	if (!result.value.content) return undefined;
	const targetId = validPersonaId(result.value.targetPersonaId, personas);
	if (!targetId) return undefined;
	return {
		content: result.value.content,
		targetPersonaId: targetId,
		selectedDiscussionPointIndex: result.value.selectedDiscussionPointIndex
	};
};

/** 出尽くし介入: 高意欲者（>= QUEUE_THRESHOLD_SCORE）がいない場合のみ発火する。ドリフト介入と同じクールダウンを共有する */
const tryStallIntervention = async ({
	personas,
	chapter,
	chapterTurns,
	state,
	engagements,
	unaddressedDiscussionPoints
}: {
	personas: Persona[];
	chapter: Chapter;
	chapterTurns: DebateTurn[];
	state: DebateState;
	engagements: Engagement[];
	unaddressedDiscussionPoints: string[];
}): Promise<
	{ content: string; targetPersonaId?: string; selectedDiscussionPointIndex?: number } | undefined
> => {
	if (hasHighEngagement(engagements)) return undefined;
	const result = await evaluateStallIntervention(
		chapterTurns,
		personas,
		state.speakCount,
		chapter,
		unaddressedDiscussionPoints.length > 0 ? unaddressedDiscussionPoints : undefined
	);
	if (!result.ok) throw new Error(pipelineErrorMessage(result.error));
	if (!result.value.content) return undefined;
	const targetId = validPersonaId(result.value.targetPersonaId, personas);
	return {
		content: result.value.content,
		targetPersonaId: targetId ?? undefined,
		selectedDiscussionPointIndex: result.value.selectedDiscussionPointIndex
	};
};
