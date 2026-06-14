import { onSnapshot, collection, query, orderBy, doc, updateDoc, writeBatch, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '$lib/firebase.js';
import type { PersonaDoc, PersonaForInterview } from '$lib/models/persona/persona.types.js';

export const createPersonasStore = (topicId: string) => {
	let personas = $state<PersonaDoc[]>([]);
	let isLoaded = $state(false);
	let unsubscribe: (() => void) | null = null;

	const start = () => {
		const q = query(
			collection(db, 'topics', topicId, 'personas'),
			orderBy('sortOrder', 'asc')
		);
		unsubscribe = onSnapshot(q, (snap) => {
			personas = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PersonaDoc);
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

	// 全ペルソナの取材完了を FE が検知した時点で、フェーズ3を生成完了として1回だけ確定する。
	// per-persona の進捗は永続化せず、リロード後は取材記録の有無から完了を再構築できる。
	const markInterviewsComplete = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			phase: 3,
			phaseStatus: 'generated',
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

	// 取材フローの実行: 実行中→（未完了ペルソナの取材）→生成完了。
	// 途中で失敗を捕捉した場合はトピックを停止状態にする。
	// all=true で全ペルソナを再取材する（再生成・やり直し用）。
	const runInterviews = async (topicTitle: string, all = false): Promise<void> => {
		await markInterviewsStarted();
		try {
			const targets = all
				? personas
				: personas.filter((p) => p.interview?.status !== 'completed');
			await Promise.all(targets.map((p) => runInterview(p.id, topicTitle)));
			await markInterviewsComplete();
		} catch (e) {
			await markInterviewsStopped();
			throw e;
		}
	};

	const runInterview = async (personaId: string, topicTitle: string): Promise<void> => {
		const persona = personas.find((p) => p.id === personaId);
		if (!persona) return;

		await updateDoc(doc(db, 'topics', topicId, 'personas', personaId), {
			interview: { status: 'in_progress' }
		});

		try {
			const fn = httpsCallable<
				{ topicTitle: string; persona: PersonaForInterview },
				{ researchSummary: string; interviewRecord: string; initialBelief: string }
			>(functions, 'runInterview', { timeout: 310000 });
			const { data } = await fn({
				topicTitle,
				persona: {
					name: persona.name,
					age: persona.age,
					occupation: persona.occupation,
					stakeholderRole: persona.stakeholderRole,
					specificRole: persona.specificRole ?? persona.stakeholderRole,
					background: persona.background,
					interests: persona.interests
				}
			});
			await updateDoc(doc(db, 'topics', topicId, 'personas', personaId), {
				interview: {
					researchSummary: data.researchSummary,
					interviewRecord: data.interviewRecord,
					status: 'completed',
					completedAt: Timestamp.now()
				},
				beliefs: [{ version: 0, content: data.initialBelief, createdAt: Timestamp.now() }]
			});
		} catch (e) {
			const errorMessage = e instanceof Error ? e.message : 'エラーが発生しました';
			await updateDoc(doc(db, 'topics', topicId, 'personas', personaId), {
				interview: { status: 'error', errorMessage }
			}).catch(() => undefined);
		}
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
		markInterviewsComplete,
		markInterviewsStopped
	};
};
