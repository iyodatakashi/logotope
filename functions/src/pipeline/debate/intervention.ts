import { Timestamp } from 'firebase-admin/firestore';
import { evaluateTopicDrift, evaluateStallIntervention } from '../../agents/facilitator-agent.js';
import { markIntroduced, getActiveDiscussionPoint } from './discussion-points.js';
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
 * 出尽くしを疑わせるソフトシグナルとして evaluateTopicDrift に渡す（決定的・I/O なし）。
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

/** 介入評価のトリガー種別。step 層が末尾指名から構築する */
export type InterventionTrigger =
	| { kind: 'no-target' }
	| { kind: 'persona-chain'; chainLength: number };

/** 介入が必要か評価し、発火した場合は state を更新して true を返す */
export const tryIntervention = async ({
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
}): Promise<boolean> => {
	// 介入判定の対象とする発言履歴（呼び出し側が章ローカルのターン列を渡す。未指定なら全ターン）
	const currentChapterTurns = chapterTurns ?? state.turns;
	// いずれかの介入が発火したらここに { 発言内容, 指名先, 提示する論点index } が入る
	let intervention:
		| { content: string; targetPersonaId?: string; selectedDiscussionPointIndex?: number }
		| undefined;

	// まだ提示していない（untouched）論点。介入時にファシリテーターへ投入候補として渡す。
	// 提示済み（introduced）を除くことで論点の再提示を防ぎ、markIntroduced の index 空間とそろえる。
	const untouchedDiscussionPoints = state.discussionPoints
		.filter((p) => p.status === 'untouched')
		.map((p) => p.point);

	// クールダウン（前回ファシリテーター発言から十分なペルソナ発言が経過）を満たすときだけ介入を評価する
	if (
		shouldEvaluateIntervention(
			countPersonaTurnsSinceFacilitator(currentChapterTurns),
			interventionCooldown
		)
	) {
		if (trigger.kind === 'persona-chain') {
			// 指名チェーン中: drift のみ評価。未提示論点は常に渡し（空化しない）、出尽くし時の次論点投入を可能にする。
			// chainLength を発展性が尽きているソフトシグナルとして drift に渡す。
			intervention = await tryTopicDriftIntervention({
				personas,
				chapter,
				chapterTurns: currentChapterTurns,
				state,
				untouchedDiscussionPoints,
				chainLength: trigger.chainLength
			});
		} else {
			// no-target: 従来挙動。高意欲者（score >= STALL_INTERVENTION_THRESHOLD_SCORE）がいる場合、
			// 論点投入を抑止して明確な逸脱のみ検出させる（未提示論点リストを渡さないことで option 2 を封じる）
			const driftPoints = hasHighEngagement(engagements) ? [] : untouchedDiscussionPoints;
			// 介入は2段カスケード: まず論点ずれ介入を試し、起きなければ出尽くし(スタール)介入を試す
			intervention = await tryTopicDriftIntervention({
				personas,
				chapter,
				chapterTurns: currentChapterTurns,
				state,
				untouchedDiscussionPoints: driftPoints
			});
			if (!intervention) {
				intervention = await tryStallIntervention({
					personas,
					chapter,
					chapterTurns: currentChapterTurns,
					state,
					engagements,
					untouchedDiscussionPoints
				});
			}
		}
	}
	if (!intervention) return false;

	// 介入が論点を1つ投入した場合、markIntroduced 経由で introduced 化し introducedOrder を採番する。
	// selectedDiscussionPointIndex は untouched 候補リスト上の index で、markIntroduced の index 空間と一致する。
	markIntroduced(state, intervention.selectedDiscussionPointIndex);

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

/** 論点ずれ＋出尽くしチェック: 介入すべきなら介入内容を返す。chainLength は出尽くしを疑うソフトシグナル */
const tryTopicDriftIntervention = async ({
	personas,
	chapter,
	chapterTurns,
	state,
	untouchedDiscussionPoints,
	chainLength
}: {
	personas: Persona[];
	chapter: Chapter;
	chapterTurns: DebateTurn[];
	state: DebateState;
	untouchedDiscussionPoints: string[];
	chainLength?: number;
}): Promise<
	{ content: string; targetPersonaId: string; selectedDiscussionPointIndex?: number } | undefined
> => {
	// 判断軸はアクティブ論点（不在時は章タイトル）。アクティブ論点も title も無ければ undefined のまま渡す（7.3）
	const activeFocus = getActiveDiscussionPoint(state) ?? chapter.title;
	const result = await evaluateTopicDrift(
		chapterTurns,
		personas,
		state.speakCount,
		chapter,
		activeFocus,
		untouchedDiscussionPoints.length > 0 ? untouchedDiscussionPoints : undefined,
		chainLength !== undefined ? { chainLength } : undefined
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
	untouchedDiscussionPoints
}: {
	personas: Persona[];
	chapter: Chapter;
	chapterTurns: DebateTurn[];
	state: DebateState;
	engagements: Engagement[];
	untouchedDiscussionPoints: string[];
}): Promise<
	{ content: string; targetPersonaId?: string; selectedDiscussionPointIndex?: number } | undefined
> => {
	if (hasHighEngagement(engagements)) return undefined;
	const activeFocus = getActiveDiscussionPoint(state) ?? chapter.title;
	const result = await evaluateStallIntervention(
		chapterTurns,
		personas,
		state.speakCount,
		chapter,
		activeFocus,
		untouchedDiscussionPoints.length > 0 ? untouchedDiscussionPoints : undefined
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
