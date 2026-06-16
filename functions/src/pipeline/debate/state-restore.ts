import type { PendingIntent } from '../../types/debate.types.js';
import type { DebateState, RestoreInput } from '../../types/debate.types.js';
import { INTENT_EXPIRY_TURNS } from '../../constants/flow.constants.js';

/** 保存済みターン・永続化キューから DebateState を一意に復元する（同一入力 → 同一出力） */
export const restoreDebateState = (input: RestoreInput): DebateState => {
	const { personas, persistedPendingIntents, currentBeliefs } = input;
	const turns = [...input.turns].sort((a, b) => a.turnIndex - b.turnIndex);

	const currentTurnIndex = turns.length > 0 ? turns[turns.length - 1].turnIndex + 1 : 0;

	const speakCount = new Map<string, number>(personas.map((p) => [p.id, 0]));
	for (const t of turns) {
		if (t.personaId && t.speakerType === 'persona') {
			speakCount.set(t.personaId, (speakCount.get(t.personaId) ?? 0) + 1);
		}
	}

	const silenceMap = new Map<string, number>();
	for (const p of personas) {
		const lastSpokeIdx = turns.reduce(
			(max, t, i) => (t.personaId === p.id && t.speakerType === 'persona' ? i : max),
			-1
		);
		silenceMap.set(p.id, Math.max(0, turns.length - lastSpokeIdx - 1));
	}

	let lastSpeakerId: string | undefined;
	let lastFacilitatorTurnIndex = 0;
	for (let i = turns.length - 1; i >= 0; i--) {
		if (turns[i].speakerType === 'persona' && turns[i].personaId && !lastSpeakerId) {
			lastSpeakerId = turns[i].personaId ?? undefined;
		}
		if (turns[i].speakerType === 'facilitator' && lastFacilitatorTurnIndex === 0) {
			lastFacilitatorTurnIndex = turns[i].turnIndex;
		}
		if (lastSpeakerId !== undefined && lastFacilitatorTurnIndex !== 0) break;
	}

	const pendingIntents = new Map<string, PendingIntent[]>();
	for (const [personaId, items] of persistedPendingIntents.entries()) {
		const alive = items.filter(
			(item) => currentTurnIndex - item.triggerTurnIndex <= INTENT_EXPIRY_TURNS
		);
		if (alive.length > 0) {
			pendingIntents.set(
				personaId,
				alive.map((item) => ({ ...item }))
			);
		}
	}

	// 直近指名の復元: 最後のターンに永続化された targetPersonaId から復元する
	// （ファシリテーターの指名 / ペルソナの直接質問。不正 ID は無視する）
	let pendingTarget: DebateState['pendingTarget'];
	const lastTurn = turns[turns.length - 1];
	if (lastTurn?.targetPersonaId && personas.some((p) => p.id === lastTurn.targetPersonaId)) {
		pendingTarget = {
			personaId: lastTurn.targetPersonaId,
			byFacilitator: lastTurn.speakerType === 'facilitator'
		};
	}

	return {
		history: turns,
		currentBeliefs: new Map(currentBeliefs),
		silenceMap,
		speakCount,
		pendingTarget,
		lastSpeakerId,
		pendingIntents,
		consecutiveDirectExchanges: 0,
		engagementSignals: [],
		currentTurnIndex,
		lastFacilitatorTurnIndex,
	};
};
