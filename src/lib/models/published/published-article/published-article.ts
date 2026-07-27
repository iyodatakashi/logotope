import { doc, getDoc, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { publicDb } from '$lib/firebase-public';
import type {
	PublishedArticle,
	PublishedChapter,
	PublishedTurn,
	PublishedAwareness,
	PublishedImpression
} from './published-article.types';
import type { TopicForFirestore } from '$lib/models/topic/topic.types';
import type { EditorialForFirestore, Narration } from '$lib/models/editorial/editorial.types';
import type { TurnForFirestore, EditedTurn } from '$lib/models/turn/turn.types';
import type {
	ChapterForFirestore,
	EditedChapterForFirestore
} from '$lib/models/chapter/chapter.types';
import type { PersonaForFirestore, PersonaForDisplay } from '$lib/models/persona/persona.types';

// 公開済み単一討論を publicDb で読み、読み物 PublishedArticle へ射影/join する。
// 読み取り入力は Admin 永続型（*ForFirestore）を参照し、必要フィールドだけを射影する。
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
	const topic = topicSnap.data() as TopicForFirestore;
	if (topic.published !== true || !topic.publishedAt) return null;

	const [editorialSnap, editedChapterSnaps, chapterSnaps, personaSnaps] = await Promise.all([
		getDoc(doc(publicDb, 'topics', topicId, 'editorial', 'outputs')),
		getDocs(
			query(collection(publicDb, 'topics', topicId, 'editedChapters'), orderBy('chapterIndex'))
		),
		getDocs(query(collection(publicDb, 'topics', topicId, 'chapters'), orderBy('chapterIndex'))),
		getDocs(query(collection(publicDb, 'topics', topicId, 'personas'), orderBy('sortOrder')))
	]);

	// ペルソナは記事あたり1回だけ id キーで持ち、発言・気づき・所感からは id で参照する。表示型 PersonaForDisplay へ写す。
	// role は永続値を直参照する（総称 stakeholderRole や旧 specificRole への導出・フォールバックは持たない・恒久排除）。
	const personas = new Map<string, PersonaForDisplay>(
		personaSnaps.docs.map((snap) => {
			const persona = snap.data() as PersonaForFirestore;
			return [
				snap.id,
				{
					id: snap.id,
					topicId,
					name: persona.name,
					role: persona.role,
					colorKey: persona.colorKey,
					avatarGeneratedAt: persona.avatarGeneratedAt?.toDate()
				}
			];
		})
	);

	// 気づきはペルソナ側に持たれるため、由来ターン id 起点に転置する（triggeredByTurnId で紐づく）。
	// 誰の気づきかは personaId のまま保持し、描画時に personas で解決する。
	const awarenessesByTurn = new Map<string, PublishedAwareness[]>();
	for (const snap of personaSnaps.docs) {
		for (const awareness of (snap.data() as PersonaForFirestore).awarenesses ?? []) {
			const list = awarenessesByTurn.get(awareness.triggeredByTurnId) ?? [];
			list.push({ personaId: snap.id, content: awareness.content });
			awarenessesByTurn.set(awareness.triggeredByTurnId, list);
		}
	}

	// 解決できない話者（ファシリテーター）は null で表す（Admin 描画と同じ規則）。
	const speakerId = (personaId: string | null | undefined): string | null =>
		personaId && personas.has(personaId) ? personaId : null;

	// 原本ターンは自ターン id、編集後ターンは連結元 sourceTurnIds 全てから気づきを集約する。
	const turnFromOriginal = (turn: TurnForFirestore): PublishedTurn => ({
		id: turn.id,
		personaId: speakerId(turn.personaId),
		content: turn.content,
		awarenesses: awarenessesByTurn.get(turn.id) ?? []
	});
	const turnFromEdited = (turn: EditedTurn): PublishedTurn => ({
		id: turn.id,
		personaId: speakerId(turn.personaId),
		content: turn.content,
		awarenesses: turn.sourceTurnIds.flatMap((sourceId) => awarenessesByTurn.get(sourceId) ?? [])
	});

	// 章は chapterIndex でペアリングし、編集後が completed のときのみ編集後、それ以外は原本にフォールバックする。
	const editedByIndex = new Map(
		editedChapterSnaps.docs.map((snap) => {
			const edited = snap.data() as EditedChapterForFirestore;
			return [edited.chapterIndex, edited];
		})
	);
	const chapters: PublishedChapter[] = chapterSnaps.docs.map((snap) => {
		const original = snap.data() as ChapterForFirestore;
		const edited = editedByIndex.get(original.chapterIndex);
		if (edited && edited.status === 'completed') {
			return {
				index: edited.chapterIndex,
				title: edited.title,
				turns: edited.turns.map(turnFromEdited)
			};
		}
		return {
			index: original.chapterIndex,
			title: original.title,
			turns: original.turns.map(turnFromOriginal)
		};
	});

	const editorial = editorialSnap.exists() ? (editorialSnap.data() as EditorialForFirestore) : null;

	// 所感は sortOrder 昇順で final ?? draft を採り、内容が無い要素は省く。
	const impressions: PublishedImpression[] = Object.entries(editorial?.impressions ?? {})
		.map(([personaId, impression]) => ({ personaId, impression }))
		.sort((a, b) => a.impression.sortOrder - b.impression.sortOrder)
		.flatMap(({ personaId, impression }) => {
			const content = impression.final ?? impression.draft;
			return content == null ? [] : [{ personaId, content }];
		});

	return {
		id: topicId,
		title: topic.title,
		publishedAt: topic.publishedAt.toDate(),
		intro: narration(editorial?.intro),
		outro: narration(editorial?.outro),
		personas,
		chapters,
		impressions
	};
};

const isPermissionDenied = (error: unknown): boolean =>
	typeof error === 'object' &&
	error !== null &&
	(error as { code?: string }).code === 'permission-denied';

// 記事要素は編集後（final）があれば編集後、無ければ原本（draft）を採用。どちらも無ければ null（省略）。
const narration = (element: Narration | undefined): string | null =>
	element?.final ?? element?.draft ?? null;
