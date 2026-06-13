import {
	doc,
	updateDoc,
	writeBatch,
	Timestamp,
	getDocs,
	collection,
	deleteField,
	getDoc,
	addDoc,
	deleteDoc
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '$lib/firebase.js';
import type { TopicDoc, StakeholderDoc } from './topic.types.js';
import type { PersonaData } from '../persona/persona.types.js';

export const createTopicStore = (topicDoc: TopicDoc) => {
	let topic = $state<TopicDoc>(topicDoc);
	const topicId = topicDoc.id;

	const approveStakeholders = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			'stakeholders.approved': true,
			phase: 2,
			phaseStatus: 'not_started',
			updatedAt: Timestamp.now()
		});
	};

	const approveInterviews = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			phase: 4,
			phaseStatus: 'not_started',
			updatedAt: Timestamp.now()
		});
	};

	const approveChapters = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			phase: 5,
			phaseStatus: 'not_started',
			updatedAt: Timestamp.now()
		});
	};

	const publishDebate = async (): Promise<void> => {
		const personasSnap = await getDocs(collection(db, 'topics', topicId, 'personas'));
		const personaCount = personasSnap.size;
		const now = Timestamp.now();
		const batch = writeBatch(db);
		batch.update(doc(db, 'topics', topicId), {
			status: 'published',
			personaCount,
			publishedAt: now,
			updatedAt: now
		});
		batch.update(doc(db, 'topics', topicId, 'sessions', '0'), {
			publishedAt: now
		});
		await batch.commit();
	};

	const generateStakeholders = async (): Promise<void> => {
		// 生成開始: フェーズ1を実行中にする
		await updateDoc(doc(db, 'topics', topicId), {
			phase: 1,
			phaseStatus: 'running',
			updatedAt: Timestamp.now()
		});

		const fn = httpsCallable<{ title: string }, { stakeholders: StakeholderDoc[] }>(
			functions,
			'generateStakeholders',
			{ timeout: 310000 }
		);
		const { data } = await fn({ title: topic.title });

		// 生成成功を前提に下流データ（ペルソナ・取材・章立て・討論）を破棄してから結果を書き込む。
		// 進行中討論があれば削除前に停止する。
		await cancelRunningDebate();
		const personasSnap = await getDocs(collection(db, 'topics', topicId, 'personas'));
		const batch = writeBatch(db);
		personasSnap.docs.forEach((d) => batch.delete(d.ref));
		batch.delete(doc(db, 'topics', topicId, 'sessions', '0'));
		batch.update(doc(db, 'topics', topicId), {
			stakeholders: { items: data.stakeholders, approved: false, createdAt: Timestamp.now() },
			phase: 1,
			phaseStatus: 'generated',
			updatedAt: Timestamp.now()
		});
		await batch.commit();
	};

	const generatePersonas = async (): Promise<void> => {
		// 生成開始: フェーズ2を実行中にする
		await updateDoc(doc(db, 'topics', topicId), {
			phase: 2,
			phaseStatus: 'running',
			updatedAt: Timestamp.now()
		});

		const stakeholders = topic.stakeholders?.items ?? [];
		const fn = httpsCallable<
			{ title: string; stakeholders: StakeholderDoc[] },
			{ personas: PersonaData[] }
		>(functions, 'generatePersonas', { timeout: 310000 });
		const { data } = await fn({ title: topic.title, stakeholders });

		// 生成成功を前提に下流（取材記録・章立て・討論セッション）と旧ペルソナを破棄する
		await cancelRunningDebate();
		await deleteDoc(doc(db, 'topics', topicId, 'sessions', '0'));
		const existing = await getDocs(collection(db, 'topics', topicId, 'personas'));
		await Promise.all(existing.docs.map((d) => deleteDoc(d.ref)));
		await Promise.all(
			data.personas.map((p, i) =>
				addDoc(collection(db, 'topics', topicId, 'personas'), {
					topicId,
					sortOrder: i,
					approved: false,
					beliefs: [],
					createdAt: Timestamp.now(),
					...p
				})
			)
		);
		await updateDoc(doc(db, 'topics', topicId), {
			phase: 2,
			phaseStatus: 'generated',
			updatedAt: Timestamp.now()
		});
	};

	const cancelRunningDebate = async (): Promise<void> => {
		const sessionRef = doc(db, 'topics', topicId, 'sessions', '0');
		const snap = await getDoc(sessionRef);
		if (snap.exists() && snap.data()?.status === 'debating') {
			await updateDoc(sessionRef, { status: 'cancelled' });
		}
	};

	const generateChapters = async (): Promise<void> => {
		// 生成開始: フェーズ4を実行中にする（章立てはクライアント権威）
		await updateDoc(doc(db, 'topics', topicId), {
			phase: 4,
			phaseStatus: 'running',
			updatedAt: Timestamp.now()
		});

		const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'generateChapters', {
			timeout: 300000
		});
		await fn({ topicId });

		// 生成成功を前提に下流データ（討論ターン）を破棄する（章立てはセッション内なので保持）
		await cancelRunningDebate();
		await updateDoc(doc(db, 'topics', topicId, 'sessions', '0'), {
			turns: [],
			postDebateComments: [],
			totalTurns: deleteField(),
			completedAt: deleteField()
		});
		await updateDoc(doc(db, 'topics', topicId), {
			phase: 4,
			phaseStatus: 'generated',
			updatedAt: Timestamp.now()
		});
	};

	const startDebate = async (): Promise<void> => {
		const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'startDebate', {
			timeout: 600000
		});
		await fn({ topicId });
	};

	// 取材をやり直す際に下流（章立て・討論セッション）を破棄する
	const clearDebateSession = async (): Promise<void> => {
		await cancelRunningDebate();
		await deleteDoc(doc(db, 'topics', topicId, 'sessions', '0'));
	};

	// 討論を再生成する: 既存の討論ターンを破棄して章立てから再討論する
	const regenerateDebate = async (): Promise<void> => {
		await cancelRunningDebate();
		await updateDoc(doc(db, 'topics', topicId, 'sessions', '0'), {
			status: 'chapters_ready',
			turns: [],
			postDebateComments: [],
			currentChapterIndex: deleteField(),
			totalTurns: deleteField(),
			completedAt: deleteField()
		});
		await startDebate();
	};

	return {
		get id() { return topic.id; },
		get title() { return topic.title; },
		get status() { return topic.status; },
		get phase() { return topic.phase; },
		get phaseStatus() { return topic.phaseStatus; },
		get createdAt() { return topic.createdAt; },
		get updatedAt() { return topic.updatedAt; },
		get publishedAt() { return topic.publishedAt; },
		get personaCount() { return topic.personaCount; },
		get stakeholders() { return topic.stakeholders; },
		_set(data: TopicDoc) {
			topic = data;
		},
		generateStakeholders,
		generatePersonas,
		generateChapters,
		startDebate,
		cancelDebate: cancelRunningDebate,
		approveStakeholders,
		approveInterviews,
		approveChapters,
		publishDebate,
		clearDebateSession,
		regenerateDebate
	};
};

export type TopicStore = ReturnType<typeof createTopicStore>;
