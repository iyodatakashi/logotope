import { Timestamp } from 'firebase-admin/firestore';
import {
	assessActiveAgendaItem,
	generateInterventionUtterance,
	type InterventionAction
} from '../../agents/facilitator-agent.js';
import {
	markIntroduced,
	markAddressed,
	getActiveAgendaItem,
	saveAgendaItemStatuses
} from './agenda.js';
import { addQueuedIntents } from './queued-intents.js';
import { addTurn } from './turn.js';
import { pipelineErrorMessage, validPersonaId } from './utils.js';
import type { DebateState, SpeakerSelection, Engagement } from '../../types/debate.types.js';
import type { DebateTurn, ProgressPatch } from '../../types/turn.types.js';
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
		(max, turn, i) => (turn.speakerType === 'facilitator' ? i : max),
		-1
	);
	return history.slice(lastFacilitatorIdx + 1).filter((turn) => turn.speakerType === 'persona')
		.length;
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

/**
 * progressAgenda の結果。
 * - 'intervened': 介入発言を1ターン永続した（継続扱い）。
 * - 'chapter-exhausted': 最後の論点が出尽くし、発言を生成せず active を addressed のみ立てた
 *   （committed-no-turn）。呼び出し側は余計な発言を挟まず章終了へ配線する。
 * - 'none': 介入なし（通常フローへ）。
 */
export type AgendaProgress = 'intervened' | 'chapter-exhausted' | 'none';

/**
 * 章アジェンダの前進を編成する単層フロー: クールダウン → 3値判定 → 行動。
 * ゲート（立場カバレッジ・指名チェーン・高意欲）を持たず、判定結果が行動を一意に決める。
 * - ongoing: 何もしない（none。状態変更・永続なし）
 * - drifted: アクティブ論点へ引き戻す（pull-back。消化しない）
 * - exhausted: アクティブ論点を addressed 化し、未提示論点を1件投入する（introduce）。
 *   未提示が残らなければ発言を生成せず addressed のみ永続して章終了へ渡す（chapter-exhausted）。
 * 発言を1ターン永続したら 'intervened' を返す。
 */
export const progressAgenda = async ({
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
}): Promise<AgendaProgress> => {
	// 介入判定の対象とする発言履歴（呼び出し側が章ローカルのターン列を渡す。未指定なら全ターン）
	const currentChapterTurns = chapterTurns ?? state.turns;

	// クールダウン未達なら評価しない（唯一の起動条件。末尾指名状態には依存しない）
	if (
		!shouldEvaluateIntervention(
			countPersonaTurnsSinceFacilitator(currentChapterTurns),
			interventionCooldown
		)
	) {
		return 'none';
	}

	// 判断軸はアクティブ論点（最新 introduced）。不在時は章タイトルへフォールバック（消化対象は無し）
	const activePoint = getActiveAgendaItem(state);
	const activeFocus = activePoint ?? chapter.title;

	// 3値判定（純粋・content なし）
	const assessment = await assessActiveAgendaItem(activeFocus, currentChapterTurns, personas);
	if (!assessment.ok) throw new Error(pipelineErrorMessage(assessment.error));
	const { verdict } = assessment.value;

	// まだ深まっている → 介入しない（状態変更・永続なし）
	if (verdict === 'ongoing') return 'none';

	// 判定結果が行動を一意に決める（ゲートなし）
	let action: InterventionAction;
	if (verdict === 'drifted') {
		// 引き戻し（消化しない）
		action = { kind: 'pull-back', activeAgendaItem: activeFocus };
	} else {
		// exhausted は前進の十分条件。立場カバレッジ・意欲スコアに依らず addressed 化＋次論点投入する。
		// 前進元（active）を addressed 化してから次項目を提示する
		if (activePoint !== undefined) markAddressed(state, activePoint);

		// まだ提示していない（untouched）論点。markIntroduced の index 空間とそろえる。
		const untouchedAgendaItems = state.agenda
			.filter((agendaItem) => agendaItem.status === 'untouched')
			.map((agendaItem) => agendaItem.point);

		if (untouchedAgendaItems.length === 0) {
			// 最後の項目: 新項目を発明せず・発言も生成せず、addressed のみ立てて永続する。
			// 呼び出し側は余計なペルソナ発言を挟まず章終了へ渡す（committed-no-turn）。
			await saveAgendaItemStatuses(topicId, chapterId, state);
			return 'chapter-exhausted';
		}
		action = { kind: 'introduce', untouchedAgendaItems };
	}

	// 行動（発言生成）
	const utterance = await generateInterventionUtterance(
		action,
		chapter,
		currentChapterTurns,
		personas
	);
	if (!utterance.ok) throw new Error(pipelineErrorMessage(utterance.error));
	const targetId = validPersonaId(utterance.value.targetPersonaId, personas);

	if (action.kind === 'pull-back') {
		// 引き戻しの指名先が有効な参加者IDでなければ採用せず継続する
		if (!targetId) return 'none';
	} else {
		// introduce: 論点を introduced 化（index は untouched リスト上の位置）
		markIntroduced(state, utterance.value.selectedAgendaItemIndex);
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
		content: utterance.value.content,
		targetPersonaId: targetId,
		chapterId: chapter.id,
		chapterTurnStartIndex,
		progressPatch
	});
	// 消化・提示の状態変更を永続する
	await saveAgendaItemStatuses(topicId, chapterId, state);
	return 'intervened';
};
