import {
	onSnapshot,
	collection,
	query,
	orderBy,
	doc,
	updateDoc,
	deleteField,
	Timestamp
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '$lib/firebase';
import {
	toPersonaForDisplay,
	type PersonaForFirestore,
	type Persona,
	type PersonaForDisplay
} from '$lib/models/persona/persona.types';

const toPersona = (id: string, raw: PersonaForFirestore): Persona => ({
	...raw,
	id,
	beliefs: raw.beliefs.map((belief) => ({ ...belief, createdAt: belief.createdAt.toDate() })),
	awarenesses: raw.awarenesses?.map((awareness) => ({
		...awareness,
		createdAt: awareness.createdAt.toDate()
	})),
	avatarGeneratedAt: raw.avatarGeneratedAt?.toDate(),
	interview: raw.interview
		? {
				...raw.interview,
				completedAt: raw.interview.completedAt?.toDate()
			}
		: undefined
});

export const createPersonasStore = (topicId: string) => {
	let personas = $state<Persona[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	// 話者名/役割・指名先などを描画時に id から解決するための Map。各画面での重複導出を避ける。
	// Map 自体は公開せず、getPersona / getPersonaForDisplay 経由でのみ解決させる（描画側は id 参照のまま持つ）。
	const personaMap = $derived(new Map(personas.map((persona) => [persona.id, persona])));

	// id からランタイム Persona を引く（ファシリテーター等で id が無い場合は undefined）。
	const getPersona = (id: string | null | undefined): Persona | undefined =>
		id ? personaMap.get(id) : undefined;

	// id から表示用 PersonaForDisplay を引く。PostItem/PersonaAvatar など表示部品にはこれを渡す。
	// ランタイム Persona → 表示型の写像は唯一の入口 toPersonaForDisplay に集約する（各画面で導出しない）。
	const getPersonaForDisplay = (id: string | null | undefined): PersonaForDisplay | undefined => {
		const persona = getPersona(id);
		return persona ? toPersonaForDisplay(persona) : undefined;
	};

	// 気づきはペルソナ側に持たれているため、原本ターン id 起点に転置して逆引きできるようにする（triggeredByTurnId で紐づく）。
	// 話者名は畳まず personaId 参照のまま保持し、描画時に getPersona で解決する。
	const awarenessesByTurn = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, { personaId: string; content: string }[]>();
		for (const persona of personas) {
			for (const awareness of persona.awarenesses ?? []) {
				map.set(awareness.triggeredByTurnId, [
					...(map.get(awareness.triggeredByTurnId) ?? []),
					{ personaId: persona.id, content: awareness.content }
				]);
			}
		}
		return map;
	});

	// 指定ターンを聞いて各ペルソナが得た気づき一覧を返す（転置Mapの表現は store 内に隠す）。
	const getAwarenessesByTurn = (turnId: string) => awarenessesByTurn.get(turnId) ?? [];

	const start = () => {
		const q = query(collection(db, 'topics', topicId, 'personas'), orderBy('sortOrder', 'asc'));
		unsubscribe = onSnapshot(q, (snap) => {
			personas = snap.docs.map((docSnapshot) =>
				toPersona(docSnapshot.id, docSnapshot.data() as PersonaForFirestore)
			);
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	// 採用/不採用の選択を当該ペルソナ文書へ永続する（安定 id キー・リロード後も保持）。
	// 討論・章立て・編集の参加者はこの selected で決まる。取材結果には影響しない（不採用でも保持）。
	const setSelected = async (personaId: string, selected: boolean): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId, 'personas', personaId), { selected });
	};

	// 名前・肩書き・年齢・プロフィールなど表示項目を当該ペルソナ文書へ永続する。
	// 長すぎる肩書きの読みやすさ調整などが目的で、取材は再実行しない（信念には影響しない）。
	const updatePersona = async (
		personaId: string,
		patch: Partial<
			Pick<
				PersonaForFirestore,
				'name' | 'role' | 'age' | 'background' | 'gender' | 'genderPresentation'
			>
		>
	): Promise<void> => {
		// 空・空白のみの役割は保存しない（総称へ自動置換せず、空欄は空欄のまま扱う）。既存 role を上書きしない。
		const sanitized = { ...patch };
		if ('role' in sanitized && (sanitized.role === undefined || sanitized.role.trim() === '')) {
			delete sanitized.role;
		}
		if (Object.keys(sanitized).length === 0) return;
		await updateDoc(doc(db, 'topics', topicId, 'personas', personaId), sanitized);
	};

	// ペルソナ単位の再取材。単一ペルソナのみを取材し、他ペルソナの結果に影響しない（成否問わず常時可能）。
	const reinterview = async (personaId: string, topicTitle: string): Promise<void> => {
		await runInterview(personaId, topicTitle);
	};

	// 1ペルソナだけアバターをやり直す（再取材と同じ操作性）。生成本体はサーバ側の core を共有する。
	// 処理開始時に旧 avatarGeneratedAt を即時クリアし、UI から処理中と分かるようにする。
	// 配色（colorKey）は生成時に確定しており、再生成の対象は画像だけなので再割り当てしない。
	const regenerateAvatar = async (personaId: string): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId, 'personas', personaId), {
			avatarGeneratedAt: deleteField()
		});
		const fn = httpsCallable<{ topicId: string; personaId: string }, Record<string, never>>(
			functions,
			'regenerateAvatar',
			{ timeout: 310000 }
		);
		await fn({ topicId, personaId });
	};

	// トピックの personas フェーズを running に書く（再取材の前に stopped→running へ戻すために使う）。
	// 名前どおり personas フェーズを書く操作であることを明示する（取材ではなくフェーズを書く・R7.3）。
	const setPersonasPhaseRunning = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			phase: 'personas',
			phaseStatus: 'running',
			updatedAt: Timestamp.now()
		});
	};

	// トピックの personas フェーズを stopped に書く（再取材失敗時。実行中・完了は既存のまま・R7.3）。
	const setPersonasPhaseStopped = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			phase: 'personas',
			phaseStatus: 'stopped',
			updatedAt: Timestamp.now()
		});
	};

	const runInterview = async (personaId: string, topicTitle: string): Promise<void> => {
		const persona = personas.find((candidate) => candidate.id === personaId);
		if (!persona) return;

		// 処理開始時に前回の取材結果（中間データ・最終信念）を即時クリアする。
		// interview の上書きで中間データが、beliefs の空配列で前回の最終信念が消える。
		await updateDoc(doc(db, 'topics', topicId, 'personas', personaId), {
			interview: { status: 'in_progress' },
			beliefs: []
		});

		// 取材結果の永続化（completed/error）はサーバ権威で行う。FE は結果を書かず onSnapshot で反映する。
		// 呼び出しの reject は握りつぶさず呼び出し元へ伝播させ、fanout 側の失敗集約に委ねる。
		// ペルソナ本体は送らない。サーバが personaId で Firestore から読む（自データの権威はサーバ）。
		const fn = httpsCallable<
			{ topicId: string; personaId: string; topicTitle: string },
			Record<string, never>
		>(functions, 'runInterview', { timeout: 310000 });
		await fn({ topicId, personaId, topicTitle });
	};

	return {
		get personas() {
			return personas;
		},
		getPersona,
		getPersonaForDisplay,
		getAwarenessesByTurn,
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop,
		setSelected,
		updatePersona,
		reinterview,
		runInterview,
		regenerateAvatar,
		setPersonasPhaseRunning,
		setPersonasPhaseStopped
	};
};
