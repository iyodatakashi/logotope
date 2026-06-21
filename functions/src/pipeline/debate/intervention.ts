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
	DebateTurn
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

/** ファシリテーター介入ターンを保存し、ターゲットがあれば SpeakerSelection を返す。世代ミスマッチ時は undefined を返す */
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
	const result = await addTurn({
		topicId,
		speakerType: 'facilitator',
		content,
		chapterId,
		targetPersonaId,
		targetedBy: targetPersonaId ? 'facilitator' : undefined,
		runId: state.runId
	});
	if (!result) return undefined;
	const { id: turnId } = result;
	state.turns.push({
		id: turnId,
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
	chapterTurns
}: {
	topicId: string;
	personas: Persona[];
	chapter: Chapter;
	chapterId: string;
	state: DebateState;
	engagements: Engagement[];
	interventionCooldown: number;
	chapterTurns?: DebateTurn[];
}): Promise<boolean> => {
	const currentChapterTurns = chapterTurns ?? state.turns;
	let intervention:
		| { content: string; targetPersonaId?: string; selectedDiscussionPointIndex?: number }
		| undefined;

	const unaddressedDiscussionPoints = state.discussionPoints
		.filter((p) => p.status !== 'addressed')
		.map((p) => p.point);

	if (
		shouldEvaluateIntervention(
			countPersonaTurnsSinceFacilitator(currentChapterTurns),
			interventionCooldown
		)
	) {
		// 高意欲者（score >= STALL_INTERVENTION_THRESHOLD_SCORE）がいる場合、論点投入を抑止して
		// 明確な逸脱のみ検出させる（未完了論点リストを渡さないことで option 2 を封じる）
		const driftPoints = hasHighEngagement(engagements) ? [] : unaddressedDiscussionPoints;
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

	if (
		intervention.selectedDiscussionPointIndex !== undefined &&
		intervention.selectedDiscussionPointIndex >= 0 &&
		intervention.selectedDiscussionPointIndex < unaddressedDiscussionPoints.length
	) {
		const introducedPoint = unaddressedDiscussionPoints[intervention.selectedDiscussionPointIndex];
		const target = state.discussionPoints.find((p) => p.point === introducedPoint);
		if (target) target.status = 'introduced';
	}

	await addQueuedIntents({
		topicId,
		chapterId,
		state,
		engagements,
		speakerSelection: { personaId: '', reason: 'score' },
		triggerTurnId: state.turns[state.turns.length - 1]?.id ?? ''
	});
	await persistInterventionTurn({
		topicId,
		state,
		content: intervention.content,
		targetPersonaId: intervention.targetPersonaId,
		chapterId: chapter.id
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
