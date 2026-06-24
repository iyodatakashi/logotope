import type { QueuedIntent, DebateState } from '../../types/debate.types.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Persona } from '../../types/persona.types.js';
import { INTENT_EXPIRY_TURNS } from '../../constants/debate.constants.js';

/** 保存済みターン・永続化キューから DebateState を導出する（同一入力 → 同一出力） */
export const getDebateState = (
	inputTurns: ReadonlyArray<DebateTurn>,
	personas: ReadonlyArray<Persona>,
	persistedQueuedIntents: ReadonlyMap<string, ReadonlyArray<QueuedIntent>>
): DebateState => {
	const turns = [...inputTurns];

	// (1) 発言回数: ペルソナごとの累計発言数。話者選択のスタール介入判定などに使う
	const speakCount = new Map<string, number>(personas.map((p) => [p.id, 0]));
	for (const t of turns) {
		if (t.personaId && t.speakerType === 'persona') {
			speakCount.set(t.personaId, (speakCount.get(t.personaId) ?? 0) + 1);
		}
	}

	// (2) 沈黙度: 各ペルソナが最後に発言してから経過したターン数。長く黙っている人を話者選択で優先する
	const silenceMap = new Map<string, number>();
	for (const p of personas) {
		// 末尾から見た最後の自発言インデックス。未発言なら -1 のまま（= 全ターン分が沈黙）
		const lastSpokeIdx = turns.reduce(
			(max, t, i) => (t.personaId === p.id && t.speakerType === 'persona' ? i : max),
			-1
		);
		silenceMap.set(p.id, Math.max(0, turns.length - lastSpokeIdx - 1));
	}

	// (3) 直前話者: 末尾から遡って最初に見つかるペルソナ発言。連続指名の回避などに使う（ファシリテーターは無視）
	let lastSpeakerId: string | undefined;
	for (let i = turns.length - 1; i >= 0; i--) {
		if (turns[i].speakerType === 'persona' && turns[i].personaId) {
			lastSpeakerId = turns[i].personaId ?? undefined;
			break;
		}
	}

	// (4) 発言意図キュー: 永続キューのうち失効していないものだけを残す。
	//     トリガーターンが既に削除済み、または INTENT_EXPIRY_TURNS ターンより古いエントリは破棄する
	const queuedIntents = new Map<string, QueuedIntent[]>();
	for (const [personaId, items] of persistedQueuedIntents.entries()) {
		const alive = items.filter((item) => {
			const triggerIdx = turns.findIndex((t) => t.id === item.triggerTurnId);
			if (triggerIdx === -1) return false;
			return turns.length - triggerIdx <= INTENT_EXPIRY_TURNS;
		});
		if (alive.length > 0) {
			queuedIntents.set(
				personaId,
				alive.map((item) => ({ ...item }))
			);
		}
	}

	return {
		turns,
		silenceMap,
		speakCount,
		lastSpeakerId,
		queuedIntents,
		discussionPoints: []
	};
};

/** 発言確定に伴い silenceMap / speakCount / lastSpeakerId を in-memory で更新する（Firestore 書き込みなし） */
export const updateSpeakerStats = ({
	state,
	personas,
	personaId
}: {
	state: DebateState;
	personas: Persona[];
	personaId: string;
}): void => {
	for (const p of personas) {
		state.silenceMap.set(p.id, p.id === personaId ? 0 : (state.silenceMap.get(p.id) ?? 0) + 1);
	}
	state.speakCount.set(personaId, (state.speakCount.get(personaId) ?? 0) + 1);
	state.lastSpeakerId = personaId;
};
