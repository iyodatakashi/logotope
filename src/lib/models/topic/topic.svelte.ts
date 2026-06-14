import {
	doc,
	updateDoc,
	setDoc,
	writeBatch,
	Timestamp,
	getDocs,
	collection,
	deleteField,
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
			personaCount,
			publishedAt: now,
			updatedAt: now
		});
		batch.update(doc(db, 'topics', topicId, 'sessions', '0'), {
			publishedAt: now
		});
		await batch.commit();
	};

	// フェーズ状態（実行中・生成完了・停止）をトピックに書く小さなヘルパー。
	const setPhaseStatus = async (phase: 1 | 2 | 3 | 4 | 5, phaseStatus: string): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			phase,
			phaseStatus,
			updatedAt: Timestamp.now()
		});
	};

	const generateStakeholders = async (): Promise<void> => {
		await setPhaseStatus(1, 'running');
		try {
			// 再生成では旧ステークホルダーと下流データ（ペルソナ・取材・章立て・討論）を即時破棄する。
			// 進行中討論はフェーズ変更によりオーケストレータのゲートが自己停止させる。
			const personasSnap = await getDocs(collection(db, 'topics', topicId, 'personas'));
			const clearBatch = writeBatch(db);
			personasSnap.docs.forEach((d) => clearBatch.delete(d.ref));
			clearBatch.delete(doc(db, 'topics', topicId, 'sessions', '0'));
			clearBatch.update(doc(db, 'topics', topicId), {
				stakeholders: { items: [], approved: false, createdAt: Timestamp.now() },
				updatedAt: Timestamp.now()
			});
			await clearBatch.commit();

			const fn = httpsCallable<{ title: string }, { stakeholders: StakeholderDoc[] }>(
				functions,
				'generateStakeholders',
				{ timeout: 310000 }
			);
			const { data } = await fn({ title: topic.title });

			await updateDoc(doc(db, 'topics', topicId), {
				stakeholders: { items: data.stakeholders, approved: false, createdAt: Timestamp.now() },
				phase: 1,
				phaseStatus: 'generated',
				updatedAt: Timestamp.now()
			});
		} catch (e) {
			await setPhaseStatus(1, 'stopped');
			throw e;
		}
	};

	const generatePersonas = async (): Promise<void> => {
		await setPhaseStatus(2, 'running');
		try {
			// 再生成では旧ペルソナと下流（取材記録・章立て・討論セッション）を即時破棄する
			await deleteDoc(doc(db, 'topics', topicId, 'sessions', '0'));
			const existing = await getDocs(collection(db, 'topics', topicId, 'personas'));
			await Promise.all(existing.docs.map((d) => deleteDoc(d.ref)));

			const stakeholders = topic.stakeholders?.items ?? [];
			const fn = httpsCallable<
				{ title: string; stakeholders: StakeholderDoc[] },
				{ personas: PersonaData[] }
			>(functions, 'generatePersonas', { timeout: 310000 });
			const { data } = await fn({ title: topic.title, stakeholders });

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
			await setPhaseStatus(2, 'generated');
		} catch (e) {
			await setPhaseStatus(2, 'stopped');
			throw e;
		}
	};

	// 討論の停止操作: トピックのフェーズ状態を停止にする。実行中のオーケストレータは
	// 次のターン境界でこれを読み自己停止する（在席非依存）。
	const stopDebate = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			phaseStatus: 'stopped',
			updatedAt: Timestamp.now()
		});
	};

	const generateChapters = async (): Promise<void> => {
		await setPhaseStatus(4, 'running');
		try {
			// 再生成では旧章立てと下流（討論ターン）を即時破棄し、処理開始をユーザーに即フィードバックする。
			// 初回生成時は session '0' が未作成のため setDoc(merge) で安全にクリア／空作成する。
			await setDoc(
				doc(db, 'topics', topicId, 'sessions', '0'),
				{
					chapters: deleteField(),
					turns: [],
					postDebateComments: [],
					totalTurns: deleteField(),
					completedAt: deleteField()
				},
				{ merge: true }
			);

			const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'generateChapters', {
				timeout: 300000
			});
			await fn({ topicId });

			await setPhaseStatus(4, 'generated');
		} catch (e) {
			await setPhaseStatus(4, 'stopped');
			throw e;
		}
	};

	const startDebate = async (): Promise<void> => {
		const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'startDebate', {
			timeout: 600000
		});
		await fn({ topicId });
	};

	// 停止した討論を currentChapterIndex から再開する
	const restartDebate = async (): Promise<void> => {
		const fn = httpsCallable<{ topicId: string }, unknown>(functions, 'restartDebate', {
			timeout: 60000
		});
		await fn({ topicId });
	};

	// 取材をやり直す際に下流（章立て・討論セッション）を破棄する
	const clearDebateSession = async (): Promise<void> => {
		await deleteDoc(doc(db, 'topics', topicId, 'sessions', '0'));
	};

	// 討論を再生成する: 既存の討論ターンを破棄して章立てから再討論する
	const regenerateDebate = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId, 'sessions', '0'), {
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
		restartDebate,
		stopDebate,
		approveStakeholders,
		approveInterviews,
		approveChapters,
		publishDebate,
		clearDebateSession,
		regenerateDebate
	};
};

export type TopicStore = ReturnType<typeof createTopicStore>;
