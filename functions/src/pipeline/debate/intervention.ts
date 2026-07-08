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
	getUnheardRelevant,
	saveAgendaItemStatuses
} from './agenda.js';
import { hasHighEngagement } from './speaker-selection.js';
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

/**
 * 章ローカル永続ターン列の末尾から、連続するペルソナ間指名（targetedBy='persona'）の数を返す。
 * ファシリテーター発言・指名なしペルソナ発言・targetedBy='facilitator' 指名に当たった時点で打ち切る。
 * step 層が persona-chain トリガーのチェーン長シグナルとして用いる（決定的・I/O なし）。
 */
export const countConsecutivePersonaTargets = (chapterTurns: readonly DebateTurn[]): number => {
	let count = 0;
	for (let i = chapterTurns.length - 1; i >= 0; i--) {
		const turn = chapterTurns[i];
		if (turn.speakerType === 'persona' && turn.targetedBy === 'persona' && turn.targetPersonaId) {
			count++;
		} else {
			break;
		}
	}
	return count;
};

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
 * 引き込み介入の採用判定: 未発言の関連参加者が残るとき、指名先がその集合に属する場合のみ採用可。
 * 未発言の関連参加者が空（ゲート不適用）なら常に採用可。
 */
const isAdoptableBringIn = (
	targetPersonaId: string | undefined,
	unheardRelevant: string[]
): boolean =>
	unheardRelevant.length === 0 ||
	(targetPersonaId !== undefined && unheardRelevant.includes(targetPersonaId));

/** 介入評価のトリガー種別。step 層が末尾指名から構築する */
export type InterventionTrigger =
	| { kind: 'no-target' }
	| { kind: 'persona-chain'; chainLength: number };

/**
 * progressAgenda の結果。
 * - 'intervened': 介入発言を1ターン永続した（継続扱い）。
 * - 'chapter-exhausted': 最後の論点が出尽くし、発言を生成せず active を addressed のみ立てた
 *   （committed-no-turn）。呼び出し側は余計な発言を挟まず章終了へ配線する。
 * - 'none': 介入なし（通常フローへ）。
 */
export type AgendaProgress = 'intervened' | 'chapter-exhausted' | 'none';

/**
 * 章アジェンダの前進を編成する: ゲート（許容行動の絞り込み）→ 判定（出尽くし/論点ずれ/継続）→
 * 消化記録（addressed）→ 行動（発言生成）。発言を1ターン永続したら true を返す。
 *
 * ゲート層（既存の保持対象挙動の写像）:
 * - クールダウン未達: 評価しない
 * - unheardActive（立場カバレッジ未充足）: 前進・消化を封じ bring-in に限定
 * - trigger=persona-chain: 前進しない（引き戻し・引き込みのみ）
 * - hasHighEngagement: 前進を抑止（強い意欲者が残る＝出尽くしていない扱い）
 */
export const progressAgenda = async ({
	topicId,
	personas,
	chapter,
	chapterId,
	state,
	engagements,
	interventionCooldown,
	trigger,
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
	trigger: InterventionTrigger;
	chapterTurns?: DebateTurn[];
	chapterTurnStartIndex?: number;
	progressPatch?: ProgressPatch;
}): Promise<AgendaProgress> => {
	// 介入判定の対象とする発言履歴（呼び出し側が章ローカルのターン列を渡す。未指定なら全ターン）
	const currentChapterTurns = chapterTurns ?? state.turns;

	// ゲート: クールダウン未達なら評価しない
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

	// 立場カバレッジ・ゲート: 現アクティブ論点で未発言の関連参加者。残る間は前進を封じ引き込みを優先する。
	const unheardRelevantIds = getUnheardRelevant(state);
	const unheardActive = unheardRelevantIds.length > 0;
	// ファシリテーターには名前で渡す（プロンプトで指名させるため）。検証には ID を使う。
	const unheardRelevantNames = unheardRelevantIds
		.map((id) => personas.find((persona) => persona.id === id)?.name)
		.filter((name): name is string => name !== undefined);

	// 判定（純粋・content なし）
	const assessment = await assessActiveAgendaItem(activeFocus, currentChapterTurns, personas);
	if (!assessment.ok) throw new Error(pipelineErrorMessage(assessment.error));
	const { verdict } = assessment.value;

	// まだ深まっている → 介入しない
	if (verdict === 'ongoing') return 'none';

	// 行動を決める（ゲートを写像）
	let action: InterventionAction;
	if (unheardActive) {
		// ゲート: 未発言の関連参加者が残る間は前進・消化を封じ、引き込みに限定する（3.3）
		action = {
			kind: 'bring-in',
			activeAgendaItem: activeFocus,
			unheardRelevant: unheardRelevantNames
		};
	} else if (verdict === 'drifted') {
		// 引き戻し（消化しない）（3.4）
		action = { kind: 'pull-back', activeAgendaItem: activeFocus };
	} else {
		// exhausted（未発言者なし）
		if (trigger.kind === 'persona-chain') return 'none'; // ゲート: チェーン中は前進しない
		if (hasHighEngagement(engagements)) return 'none'; // ゲート: 強い意欲者が残る間は前進を抑止

		// 前進: 前進元（active）を addressed 化してから次項目を提示する（3.1）
		if (activePoint !== undefined) markAddressed(state, activePoint);

		// まだ提示していない（untouched）論点。markIntroduced の index 空間とそろえる。
		const untouchedAgendaItems = state.agenda
			.filter((agendaItem) => agendaItem.status === 'untouched')
			.map((agendaItem) => agendaItem.point);

		if (untouchedAgendaItems.length === 0) {
			// 最後の項目: 新項目を発明せず・発言も生成せず、addressed のみ立てて永続する（3.2）。
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

	if (action.kind === 'bring-in') {
		// 引き込み先が未発言の関連参加者に属する場合のみ採用（前進・消化はしない）
		if (!isAdoptableBringIn(targetId, unheardRelevantIds)) return 'none';
	} else if (action.kind === 'pull-back') {
		if (!targetId) return 'none';
	} else {
		// introduce: 論点を introduced 化（index は untouched リスト上の位置）。関連参加者を有効IDへフィルタして記録。
		markIntroduced(
			state,
			utterance.value.selectedAgendaItemIndex,
			utterance.value.relevantPersonaIds?.filter((id) =>
				personas.some((persona) => persona.id === id)
			)
		);
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
