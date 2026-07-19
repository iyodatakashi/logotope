import { doc, getDoc, collection, getDocs, query, orderBy, type Timestamp } from 'firebase/firestore';
import { publicDb } from '$lib/firebase-public';
import type {
	PublishedArticle,
	PublishedChapter,
	PublishedTurn,
	PublishedAwareness,
	PublishedImpression
} from './published-article.types';
import { FACILITATOR_NAME } from '$lib/models/turn/turn.constants';

// 読み取り元の最小 shape（Admin 型・*ForFirestore は経由せず、Firestore 永続形の必要フィールドだけを写す）。
type TopicDoc = { title: string; published?: boolean; publishedAt?: Timestamp };
type NarrationDoc = { draft: string | null; final: string | null };
type ImpressionDoc = { sortOrder: number; draft: string | null; final: string | null };
type EditorialDoc = {
	intro?: NarrationDoc;
	outro?: NarrationDoc;
	impressions?: Record<string, ImpressionDoc>;
};
type TurnDoc = {
	id: string;
	speakerType: 'facilitator' | 'persona';
	personaId?: string | null;
	content: string;
};
type EditedTurnDoc = TurnDoc & { sourceTurnIds: string[] };
type ChapterDoc = { chapterIndex: number; title: string; turns: TurnDoc[] };
type EditedChapterDoc = {
	chapterIndex: number;
	title: string;
	status: 'pending' | 'completed' | 'failed';
	turns: EditedTurnDoc[];
};
type AwarenessDoc = { content: string; triggeredByTurnId: string };
type PersonaDoc = { name: string; specificRole?: string; stakeholderRole: string; awarenesses?: AwarenessDoc[] };


// 公開済み単一討論を publicDb で読み、読み物 PublishedArticle へ射影/join する。
// 記事なし（不在・未公開・permission-denied）は null。それ以外の取得失敗のみ throw。
export const fetchPublishedArticle = async (topicId: string): Promise<PublishedArticle | null> => {
	let topicSnap;
	try {
		topicSnap = await getDoc(doc(publicDb, 'topics', topicId));
	} catch (error) {
		if (isPermissionDenied(error)) return null;
		throw error;
	}
	if (!topicSnap.exists()) return null;
	const topic = topicSnap.data() as TopicDoc;
	if (topic.published !== true || !topic.publishedAt) return null;

	const [editorialSnap, editedChapterSnaps, chapterSnaps, personaSnaps] = await Promise.all([
		getDoc(doc(publicDb, 'topics', topicId, 'editorial', '0')),
		getDocs(query(collection(publicDb, 'topics', topicId, 'editedChapters'), orderBy('chapterIndex'))),
		getDocs(query(collection(publicDb, 'topics', topicId, 'chapters'), orderBy('chapterIndex'))),
		getDocs(query(collection(publicDb, 'topics', topicId, 'personas'), orderBy('sortOrder')))
	]);

	const personaById = new Map(personaSnaps.docs.map((snap) => [snap.id, snap.data() as PersonaDoc]));

	// 気づきはペルソナ側に持たれるため、由来ターン id 起点に転置してペルソナ名を焼き込む（triggeredByTurnId で紐づく）。
	const awarenessesByTurn = new Map<string, PublishedAwareness[]>();
	for (const persona of personaById.values()) {
		for (const awareness of persona.awarenesses ?? []) {
			const list = awarenessesByTurn.get(awareness.triggeredByTurnId) ?? [];
			list.push({ personaName: persona.name, content: awareness.content });
			awarenessesByTurn.set(awareness.triggeredByTurnId, list);
		}
	}

	// 話者は personaId から解決し、解決できなければファシリテーター表記にする（Admin 描画と同じ規則）。
	const resolveSpeaker = (personaId: string | null | undefined) => {
		const persona = personaId ? personaById.get(personaId) : undefined;
		return persona
			? {
					speakerType: 'persona' as const,
					speakerName: persona.name,
					speakerRole: persona.specificRole ?? persona.stakeholderRole ?? ''
				}
			: { speakerType: 'facilitator' as const, speakerName: FACILITATOR_NAME, speakerRole: '' };
	};

	// 原本ターンは自ターン id、編集後ターンは連結元 sourceTurnIds 全てから気づきを集約する。
	const turnFromOriginal = (turn: TurnDoc): PublishedTurn => ({
		id: turn.id,
		...resolveSpeaker(turn.personaId),
		content: turn.content,
		awarenesses: awarenessesByTurn.get(turn.id) ?? []
	});
	const turnFromEdited = (turn: EditedTurnDoc): PublishedTurn => ({
		id: turn.id,
		...resolveSpeaker(turn.personaId),
		content: turn.content,
		awarenesses: turn.sourceTurnIds.flatMap((sourceId) => awarenessesByTurn.get(sourceId) ?? [])
	});

	// 章は chapterIndex でペアリングし、編集後が completed のときのみ編集後、それ以外は原本にフォールバックする。
	const editedByIndex = new Map(
		editedChapterSnaps.docs.map((snap) => {
			const edited = snap.data() as EditedChapterDoc;
			return [edited.chapterIndex, edited];
		})
	);
	const chapters: PublishedChapter[] = chapterSnaps.docs.map((snap) => {
		const original = snap.data() as ChapterDoc;
		const edited = editedByIndex.get(original.chapterIndex);
		if (edited && edited.status === 'completed') {
			return { index: edited.chapterIndex, title: edited.title, turns: edited.turns.map(turnFromEdited) };
		}
		return { index: original.chapterIndex, title: original.title, turns: original.turns.map(turnFromOriginal) };
	});

	const editorial = editorialSnap.exists() ? (editorialSnap.data() as EditorialDoc) : null;

	// 所感は sortOrder 昇順で final ?? draft を採り、内容が無い要素は省く。
	const impressions: PublishedImpression[] = Object.entries(editorial?.impressions ?? {})
		.map(([personaId, impression]) => ({ personaId, impression }))
		.sort((a, b) => a.impression.sortOrder - b.impression.sortOrder)
		.flatMap(({ personaId, impression }) => {
			const content = impression.final ?? impression.draft;
			if (content == null) return [];
			const persona = personaById.get(personaId);
			return [
				{
					personaId,
					speakerName: persona?.name ?? FACILITATOR_NAME,
					speakerRole: persona?.specificRole ?? persona?.stakeholderRole ?? '',
					content
				}
			];
		});

	return {
		id: topicId,
		title: topic.title,
		publishedAt: topic.publishedAt.toDate(),
		intro: narration(editorial?.intro),
		outro: narration(editorial?.outro),
		chapters,
		impressions
	};
};

const isPermissionDenied = (error: unknown): boolean =>
	typeof error === 'object' && error !== null && (error as { code?: string }).code === 'permission-denied';

// 記事要素は編集後（final）があれば編集後、無ければ原本（draft）を採用。どちらも無ければ null（省略）。
const narration = (element: NarrationDoc | undefined): string | null => element?.final ?? element?.draft ?? null;
