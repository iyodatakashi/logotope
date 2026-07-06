import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import type {
	DiscussionPointState,
	ChapterProgress,
	ChapterEntry
} from '../../types/chapter.types.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Chapter } from '../../types/chapter.types.js';

const db = () => getFirestore();

type ChapterDocData = {
	chapterIndex: number;
	title: string;
	discussionPoints?: string[];
	turns?: Array<{
		id: string;
		speakerType: string;
		personaId?: string;
		content: string;
		createdAt: Timestamp;
		fromQueue?: boolean;
		targetPersonaId?: string;
		targetedBy?: 'facilitator' | 'persona';
	}>;
	status?: 'pending' | 'running' | 'completed';
};

const toChapterEntry = (id: string, data: ChapterDocData): ChapterEntry => ({
	id,
	chapterIndex: data.chapterIndex,
	title: data.title,
	discussionPoints: data.discussionPoints ?? [],
	turns: (data.turns ?? []).map((turn) => ({
		id: turn.id,
		speakerType: turn.speakerType,
		personaId: turn.personaId ?? null,
		content: turn.content,
		createdAt: turn.createdAt,
		fromQueue: turn.fromQueue,
		targetPersonaId: turn.targetPersonaId,
		targetedBy: turn.targetedBy
	})),
	status: data.status ?? 'pending'
});

/** 章を chapterIndex 順に読み取り、ターン・論点・ステータスを含む ChapterEntry の配列で返す */
export const getChaptersByTopicId = async (topicId: string): Promise<ChapterEntry[]> => {
	const snap = await db().collection(`topics/${topicId}/chapters`).orderBy('chapterIndex').get();
	return snap.docs.map((docSnap) => toChapterEntry(docSnap.id, docSnap.data() as ChapterDocData));
};

/** 単一の章を読み取り、ターン・論点・ステータスを含む ChapterEntry で返す。存在しなければ null */
export const getChapterById = async (
	topicId: string,
	chapterId: string
): Promise<ChapterEntry | null> => {
	const snap = await db().doc(`topics/${topicId}/chapters/${chapterId}`).get();
	if (!snap.exists) return null;
	return toChapterEntry(chapterId, snap.data() as ChapterDocData);
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
				targetedBy?: 'facilitator' | 'persona';
			}>;
		};
		const turns = (data.turns ?? []).map((turn) => ({
			id: turn.id,
			speakerType: turn.speakerType,
			personaId: turn.personaId ?? null,
			content: turn.content,
			createdAt: turn.createdAt,
			fromQueue: turn.fromQueue,
			targetPersonaId: turn.targetPersonaId,
			targetedBy: turn.targetedBy
		}));
		allTurns.push(...turns);
	}
	return allTurns;
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

/** 章のステータス（running / completed など）を更新する */
export const updateChapterStatus = async (
	topicId: string,
	chapterId: string,
	status: ChapterEntry['status']
): Promise<void> => {
	await db().doc(`topics/${topicId}/chapters/${chapterId}`).update({ status });
};

/** 指定章以降を破棄対象として turns/進捗/status をリセットし、破棄した章を返す */
export const discardChaptersFrom = async (
	topicId: string,
	chapterId: string
): Promise<ChapterEntry[]> => {
	const chapters = await getChaptersByTopicId(topicId);
	const targetIdx = chapters.findIndex((chapter) => chapter.id === chapterId);
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
