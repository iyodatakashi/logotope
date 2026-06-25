import { onSnapshot, collection, doc, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '$lib/firebase';
import type {
	FactCheckResult,
	FactCheckResultForFirestore
} from '$lib/models/factCheck/factCheck.types';

export const toFactCheckResult = (raw: FactCheckResultForFirestore): FactCheckResult => ({
	...raw,
	startedAt: raw.startedAt.toDate(),
	completedAt: raw.completedAt?.toDate()
});

export type FactCheckRunState = { pending: boolean; error: string | null };

const IDLE_RUN_STATE: FactCheckRunState = { pending: false, error: null };

export const createFactCheckStore = (topicId: string) => {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	let resultsMap = $state<Map<string, FactCheckResult>>(new Map());
	// 実行要求のローカル状態（サーバーの running 書き込みを待たず即時にUIへ反映する。
	// ハードクラッシュで Firestore が running のまま固まっても、ここで失敗を提示できる）
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	let runStates = $state<Map<string, FactCheckRunState>>(new Map());
	let unsubscribes: Array<() => void> = [];

	const setRunState = (chapterId: string, state: FactCheckRunState) => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const next = new Map(runStates);
		next.set(chapterId, state);
		runStates = next;
	};

	const start = () => {
		const chaptersRef = collection(db, 'topics', topicId, 'chapters');
		getDocs(chaptersRef).then((snap) => {
			unsubscribes = snap.docs.map((chapterDoc) => {
				const chapterId = chapterDoc.id;
				const ref = doc(db, 'topics', topicId, 'chapters', chapterId, 'factCheck', 'result');
				return onSnapshot(ref, (docSnap) => {
					// eslint-disable-next-line svelte/prefer-svelte-reactivity
					const next = new Map(resultsMap);
					if (docSnap.exists()) {
						next.set(chapterId, toFactCheckResult(docSnap.data() as FactCheckResultForFirestore));
					} else {
						next.delete(chapterId);
					}
					resultsMap = next;
				});
			});
		});
	};

	const stop = () => {
		unsubscribes.forEach((unsubscribe) => unsubscribe());
		unsubscribes = [];
	};

	// 実行アクションは討論画面近傍に置く（中央ディスパッチャは作らない）
	const runFactCheck = async (chapterId: string) => {
		setRunState(chapterId, { pending: true, error: null });
		try {
			const fn = httpsCallable<
				{ topicId: string; chapterId: string },
				{ topicId: string; chapterId: string }
			>(functions, 'runFactCheck', { timeout: 550000 });
			await fn({ topicId, chapterId });
			setRunState(chapterId, { pending: false, error: null });
		} catch (err) {
			// 握りつぶさず、章ごとの失敗としてUIに提示する
			setRunState(chapterId, {
				pending: false,
				error: err instanceof Error ? err.message : String(err)
			});
		}
	};

	const getRunState = (chapterId: string): FactCheckRunState =>
		runStates.get(chapterId) ?? IDLE_RUN_STATE;

	return {
		get resultsMap() {
			return resultsMap;
		},
		getRunState,
		start,
		stop,
		runFactCheck
	};
};

export type FactCheckStore = ReturnType<typeof createFactCheckStore>;
