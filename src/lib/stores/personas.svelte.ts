import {
	onSnapshot,
	collection,
	query,
	orderBy,
	doc,
	getDoc,
	updateDoc,
	writeBatch,
	Timestamp
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '$lib/firebase';
import type {
	PersonaForFirestore,
	Persona,
	PersonaForInterview
} from '$lib/models/persona/persona.types';
import type { TopicContext } from '$lib/models/topic/topic.types';

const toPersona = (id: string, raw: PersonaForFirestore): Persona => ({
	...raw,
	id,
	beliefs: raw.beliefs.map((b) => ({ ...b, createdAt: b.createdAt.toDate() })),
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

	const start = () => {
		const q = query(collection(db, 'topics', topicId, 'personas'), orderBy('sortOrder', 'asc'));
		unsubscribe = onSnapshot(q, (snap) => {
			personas = snap.docs.map((d) => toPersona(d.id, d.data() as PersonaForFirestore));
			isLoaded = true;
		});
	};

	const stop = () => {
		unsubscribe?.();
		unsubscribe = null;
	};

	const approvePersonas = async (): Promise<void> => {
		const batch = writeBatch(db);
		personas.forEach((p) => {
			batch.update(doc(db, 'topics', topicId, 'personas', p.id), { approved: true });
		});
		batch.update(doc(db, 'topics', topicId), {
			phase: 3,
			phaseStatus: 'not_started',
			updatedAt: Timestamp.now()
		});
		await batch.commit();
	};

	const resetPersonas = async (): Promise<void> => {
		const batch = writeBatch(db);
		personas.forEach((p) => {
			batch.delete(doc(db, 'topics', topicId, 'personas', p.id));
		});
		batch.update(doc(db, 'topics', topicId), {
			phase: 2,
			phaseStatus: 'not_started',
			updatedAt: Timestamp.now()
		});
		await batch.commit();
	};

	const markInterviewsStarted = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			phase: 3,
			phaseStatus: 'running',
			updatedAt: Timestamp.now()
		});
	};

	// 取材失敗時にトピックを停止状態にする（実行中・完了は既存のまま）
	const markInterviewsStopped = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			phase: 3,
			phaseStatus: 'stopped',
			updatedAt: Timestamp.now()
		});
	};

	// 取材フローの実行: 実行中→（未完了ペルソナを並列取材）。
	// 結果の永続化と完了確定（generated）はサーバ権威で行うため、FE は完了を書かない。
	// all=true で全ペルソナを再取材する（再生成・やり直し用）。
	const runInterviews = async (
		topicTitle: string,
		topicContext?: TopicContext,
		all = false
	): Promise<void> => {
		await markInterviewsStarted();
		const targets = all ? personas : personas.filter((p) => p.interview?.status !== 'completed');
		const results = await Promise.allSettled(
			targets.map((p) => runInterview(p.id, topicTitle, topicContext))
		);
		// 失敗検知は rejected の有無で行う（onSnapshot の反映遅延に依存しない）。
		const hasError = results.some((r) => r.status === 'rejected');
		if (hasError) {
			// サーバが既に generated を確定済み（reject はタイムアウト等）の場合は stopped に上書きしない。
			const snap = await getDoc(doc(db, 'topics', topicId));
			if (snap.data()?.phaseStatus !== 'generated') {
				await markInterviewsStopped();
			}
		}
	};

	const runInterview = async (
		personaId: string,
		topicTitle: string,
		topicContext?: TopicContext
	): Promise<void> => {
		const persona = personas.find((p) => p.id === personaId);
		if (!persona) return;

		// 処理開始時に前回の取材結果（中間データ・最終信念）を即時クリアする。
		// interview の上書きで中間データが、beliefs の空配列で前回の最終信念が消える。
		await updateDoc(doc(db, 'topics', topicId, 'personas', personaId), {
			interview: { status: 'in_progress' },
			beliefs: []
		});

		// 取材結果の永続化（completed/error）はサーバ権威で行う。FE は結果を書かず onSnapshot で反映する。
		// 呼び出しの reject は握りつぶさず呼び出し元へ伝播させ、fanout 側の失敗集約に委ねる。
		const fn = httpsCallable<
			{
				topicId: string;
				personaId: string;
				topicTitle: string;
				persona: PersonaForInterview;
				topicContext?: TopicContext;
			},
			Record<string, never>
		>(functions, 'runInterview', { timeout: 310000 });
		await fn({
			topicId,
			personaId,
			topicTitle,
			persona: {
				name: persona.name,
				age: persona.age,
				occupation: persona.occupation,
				stakeholderRole: persona.stakeholderRole,
				specificRole: persona.specificRole ?? persona.stakeholderRole,
				background: persona.background,
				interests: persona.interests
			},
			...(topicContext && { topicContext })
		});
	};

	return {
		get personas() {
			return personas;
		},
		get isLoaded() {
			return isLoaded;
		},
		start,
		stop,
		runInterview,
		runInterviews,
		approvePersonas,
		resetPersonas,
		markInterviewsStarted,
		markInterviewsStopped
	};
};
