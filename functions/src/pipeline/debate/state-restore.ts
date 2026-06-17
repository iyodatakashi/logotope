import type { DebateTurn, QueuedIntent, DebateState } from '../../types/debate.types.js';
import type { Persona } from '../../types/persona.types.js';
import { INTENT_EXPIRY_TURNS } from '../../constants/flow.constants.js';

/** 保存済みターン・永続化キューから DebateState を一意に復元する（同一入力 → 同一出力） */
export const restoreDebateState = (
	inputTurns: ReadonlyArray<DebateTurn>,
	personas: ReadonlyArray<Persona>,
	persistedQueuedIntents: ReadonlyMap<string, ReadonlyArray<QueuedIntent>>
): DebateState => {
	const turns = [...inputTurns].sort((a, b) => a.turnIndex - b.turnIndex);

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

	const queuedIntents = new Map<string, QueuedIntent[]>();
	for (const [personaId, items] of persistedQueuedIntents.entries()) {
		const alive = items.filter(
			(item) => currentTurnIndex - item.triggerTurnIndex <= INTENT_EXPIRY_TURNS
		);
		if (alive.length > 0) {
			queuedIntents.set(
				personaId,
				alive.map((item) => ({ ...item }))
			);
		}
	}

	// 直近指名の復元: 最後のターンに永続化された targetPersonaId から復元する
	// （ファシリテーターの指名 / ペルソナの直接質問。不正 ID は無視する）
	let targetPersona: DebateState['targetPersona'];
	const lastTurn = turns[turns.length - 1];
	if (lastTurn?.targetPersonaId && personas.some((p) => p.id === lastTurn.targetPersonaId)) {
		targetPersona = {
			personaId: lastTurn.targetPersonaId,
			targetedBy: lastTurn.speakerType === 'facilitator' ? 'facilitator' : 'persona'
		};
	}

	return {
		turns,
		silenceMap,
		speakCount,
		targetPersona,
		lastSpeakerId,
		queuedIntents,
		pairConversationTurns: 0,
		currentTurnIndex,
		lastFacilitatorTurnIndex,
	};
};
