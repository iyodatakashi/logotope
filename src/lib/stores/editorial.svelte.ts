import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type {
	EditorialForFirestore,
	NarrationPartForFirestore,
	ImpressionPartForFirestore
} from '$lib/models/editorial/editorial.types';

// 統合保存 editorial/0（導入・締め・所感）を購読し、記事要素を公開する。
// 導入/締め/所感を1ドキュメントに集約したため、旧 editedIntroClosing / postDebateComments /
// editedPostDebateComments の各ストアはこの1本に置き換わる。欠落項目は空（null / {}）で補完する。
export const createEditorialStore = (topicId: string) => {
	const empty = (): NarrationPartForFirestore => ({ draft: null, final: null });
	let intro = $state<NarrationPartForFirestore>(empty());
	let outro = $state<NarrationPartForFirestore>(empty());
	let impressions = $state<Record<string, ImpressionPartForFirestore>>({});
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		unsubscribe = onSnapshot(doc(db, 'topics', topicId, 'editorial', '0'), (snap) => {
			const data = snap.exists() ? (snap.data() as Partial<EditorialForFirestore>) : {};
			intro = data.intro ?? empty();
			outro = data.outro ?? empty();
			impressions = data.impressions ?? {};
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
