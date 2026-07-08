import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type {
	EditorialForFirestore,
	Narration,
	Impression
} from '$lib/models/editorial/editorial.types';

// 統合保存 editorial/0（導入・締め・所感）を購読し、記事要素を公開する。
// 導入/締め/所感を1ドキュメントに集約したため、旧 editedIntroClosing / postDebateComments /
// editedPostDebateComments の各ストアはこの1本に置き換わる。欠落項目は空（null / {}）で補完する。
export const createEditorialStore = (topicId: string) => {
	const empty = (): Narration => ({ draft: null, final: null });
	let intro = $state<Narration>(empty());
	let outro = $state<Narration>(empty());
	let impressions = $state<Impression[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'editorial', '0'), (snap) => {
			const data = snap.exists() ? (snap.data() as Partial<EditorialForFirestore>) : {};
			intro = data.intro ?? empty();
			outro = data.outro ?? empty();
			// 永続形（personaId キーのマップ）は境界でフロント用 Impression 配列に変換して保持する。
			impressions = Object.entries(data.impressions ?? {})
				.map(([personaId, part]) => ({ personaId, ...part }))
				.sort((a, b) => a.sortOrder - b.sortOrder);
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	return {
		get intro() {
			return intro;
		},
		get outro() {
			return outro;
		},
		get impressions() {
			return impressions;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop
	};
};

export type EditorialStore = ReturnType<typeof createEditorialStore>;
