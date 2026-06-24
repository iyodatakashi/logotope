import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import type {
	DebateTurn,
	QueuedIntent,
	DebateState,
	DiscussionPointState,
	ChapterProgress,
	ChapterEntry
} from '../../types/debate.types.js';
import type { Persona } from '../../types/persona.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import { INTENT_EXPIRY_TURNS } from '../../constants/debate.constants.js';

const db = () => getFirestore();

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

/**
 * chapter doc から章進捗を復元する。quietStreak 未設定は 0、discussionPointStatuses 未設定は
 * 章の論点から untouched 初期化する。同一の永続データから同一の出力を返す（決定論）。
 */
export const loadChapterProgress = async (
	topicId: string,
	chapterId: string,
	chapter: Chapter
): Promise<ChapterProgress> => {
	const snap = await db().doc(`topics/${topicId}/chapters/${chapterId}`).get();
	const data = snap.data() as
		| { quietStreak?: number; discussionPointStatuses?: DiscussionPointState[] }
		| undefined;
	const discussionPointStatuses =
		data?.discussionPointStatuses ??
		(chapter.discussionPoints ?? []).map((point) => ({ point, status: 'untouched' as const }));
	return {
		quietStreak: data?.quietStreak ?? 0,
		discussionPointStatuses
	};
};

/** 章を chapterIndex 順に読み取り、ターン・論点・ステータスを含む ChapterEntry の配列で返す */
export const getChaptersByTopicId = async (topicId: string): Promise<ChapterEntry[]> => {
	const snap = await db().collection(`topics/${topicId}/chapters`).orderBy('chapterIndex').get();
	return snap.docs.map((docSnap) => {
		const data = docSnap.data() as {
			chapterIndex: number;
			title: string;
			focusQuestion: string;
			discussionPoints?: string[];
			turns?: Array<{
				id: string;
				speakerType: string;
				personaId?: string;
				content: string;
				createdAt: Timestamp;
				fromQueue?: boolean;
				targetPersonaId?: string;
			}>;
			status?: 'pending' | 'running' | 'completed';
		};
		return {
			id: docSnap.id,
			chapterIndex: data.chapterIndex,
			title: data.title,
			focusQuestion: data.focusQuestion,
			discussionPoints: data.discussionPoints ?? [],
			turns: (data.turns ?? []).map((t) => ({
				id: t.id,
				speakerType: t.speakerType,
				personaId: t.personaId ?? null,
				content: t.content,
				createdAt: t.createdAt,
				fromQueue: t.fromQueue,
				targetPersonaId: t.targetPersonaId
			})),
			status: data.status ?? 'pending'
		};
	});
};

/** 全章のターンを chapterIndex 順に連結して返す */
export const getDebateTurnsByTopicId = async (topicId: string): Promise<DebateTurn[]> => {
	const snap = await db().collection(`topics/${topicId}/chapters`).orderBy('chapterIndex').get();
	const allTurns: DebateTurn[] = [];
	for (const chapterDoc of snap.docs) {
		const data = chapterDoc.data() as {
			turns?: Array<{
				id: string;
				speakerType: string;
				personaId?: string;
				content: string;
				createdAt: Timestamp;
				fromQueue?: boolean;
				targetPersonaId?: string;
			}>;
		};
		const turns = (data.turns ?? []).map((t) => ({
			id: t.id,
			speakerType: t.speakerType,
			personaId: t.personaId ?? null,
			content: t.content,
			createdAt: t.createdAt,
			fromQueue: t.fromQueue,
			targetPersonaId: t.targetPersonaId
		}));
		allTurns.push(...turns);
	}
	return allTurns;
};

/** 討論が稼働中（phase 5 かつ phaseStatus running）かを判定する */
export const isDebateActive = async (topicId: string): Promise<boolean> => {
	const snap = await db().doc(`topics/${topicId}`).get();
	if (!snap.exists) return false;
	const data = snap.data() as { phase?: number; phaseStatus?: string };
	return data.phase === 5 && data.phaseStatus === 'running';
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

/** 指定章以降を破棄対象として turns/進捗/status をリセットし、破棄した章を返す */
export const discardChaptersFrom = async (
	topicId: string,
	chapterId: string
): Promise<ChapterEntry[]> => {
	const chapters = await getChaptersByTopicId(topicId);
	const targetIdx = chapters.findIndex((c) => c.id === chapterId);
	const discardChapters = chapters.slice(targetIdx >= 0 ? targetIdx : 0);
	for (const chapter of discardChapters) {
		await db().doc(`topics/${topicId}/chapters/${chapter.id}`).update({
			turns: [],
			discussionPointStatuses: FieldValue.delete(),
			quietStreak: FieldValue.delete(),
			status: 'pending'
		});
	}
	return discardChapters;
};
