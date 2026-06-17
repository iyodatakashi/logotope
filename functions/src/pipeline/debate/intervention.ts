import {
	evaluateTopicDrift,
	evaluateStallIntervention
} from '../../agents/facilitator-agent.js';
import { shouldSpeak } from './speaker-selection.js';
import { addQueuedIntents } from './queued-intents.js';
import { addTurn } from './turn.js';
import { pipelineErrorMessage, validPersonaId } from './utils.js';
import type { DebateState, SpeakerSelection, Engagement } from '../../types/debate.types.js';
import type { DebateTurn } from '../../types/debate.types.js';
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
		targetPersonaId,
		targetedBy: targetPersonaId ? 'facilitator' : undefined
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
		targetPersonaId,
		targetedBy: targetPersonaId ? 'facilitator' : undefined
	});
	state.pairConversationTurns = 0;
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
	if (shouldEvaluateIntervention(countPersonaTurnsSinceFacilitator(state.turns), interventionCooldown)) {
		intervention = await tryTopicDriftIntervention({ personas, chapter, state });
		if (!intervention) {
			intervention = await tryStallIntervention({ personas, chapter, state, engagements });
		}
	}
	if (!intervention) return false;

	await addQueuedIntents({
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
	return true;
};

/** 論点ずれチェック: 逸脱していれば介入内容を返す。クールダウン通過後かつ指名なし時のみ評価する */
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
