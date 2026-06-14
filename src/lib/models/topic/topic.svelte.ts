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

	// --- 旧データのリセット（データ層ごと。各 reset はその層のデータだけを消す） ---
	// 再生成では、各フェーズ画面の regenerate ハンドラが「自フェーズ＋下流ぶん」を合成して呼ぶ。

	// ステークホルダー（トピックの stakeholders フィールド）を空に戻す。
	const resetStakeholders = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			stakeholders: { items: [], approved: false, createdAt: Timestamp.now() },
			updatedAt: Timestamp.now()
		});
	};

	// ペルソナ（personas サブコレクション。取材記録・信念もペルソナ文書に含まれる）を全削除する。
	const resetPersonas = async (): Promise<void> => {
		const personasSnap = await getDocs(collection(db, 'topics', topicId, 'personas'));
		await Promise.all(personasSnap.docs.map((personaDoc) => deleteDoc(personaDoc.ref)));
	};

	// 章立て（セッションの chapters）を消す。session '0' 未作成でも安全なよう merge で書く。
	const resetChapters = async (): Promise<void> => {
		await setDoc(
			doc(db, 'topics', topicId, 'sessions', '0'),
			{ chapters: deleteField(), chapterIssues: deleteField() },
			{ merge: true }
		);
	};

	// 討論（セッションの turns・進行状態・発言意欲。章立ては残す）を消す。session '0' 未作成でも安全。
	const resetDebate = async (): Promise<void> => {
		// engagements はペルソナidをキーにした討論時データ。古いペルソナidが残らないよう全削除する。
		const engagementsSnap = await getDocs(
			collection(db, 'topics', topicId, 'sessions', '0', 'engagements')
		);
		await Promise.all(engagementsSnap.docs.map((engagementDoc) => deleteDoc(engagementDoc.ref)));
		await setDoc(
			doc(db, 'topics', topicId, 'sessions', '0'),
			{
				turns: [],
				postDebateComments: [],
				currentChapterIndex: deleteField(),
				totalTurns: deleteField(),
				completedAt: deleteField()
			},
			{ merge: true }
		);
	};

	// --- 生成（各 generate は生成と書き込みのみ。旧データの削除は上の reset が担う） ---

	const generateStakeholders = async (): Promise<void> => {
		await setPhaseStatus(1, 'running');
		try {
			const generateStakeholdersCallable = httpsCallable<
				{ title: string },
				{ stakeholders: StakeholderDoc[] }
			>(functions, 'generateStakeholders', { timeout: 310000 });
			const { data } = await generateStakeholdersCallable({ title: topic.title });

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
			const stakeholders = topic.stakeholders?.items ?? [];
			const generatePersonasCallable = httpsCallable<
				{ title: string; stakeholders: StakeholderDoc[] },
				{ personas: PersonaData[] }
			>(functions, 'generatePersonas', { timeout: 310000 });
			const { data } = await generatePersonasCallable({ title: topic.title, stakeholders });

			await Promise.all(
				data.personas.map((persona, index) =>
					addDoc(collection(db, 'topics', topicId, 'personas'), {
						topicId,
						sortOrder: index,
						approved: false,
						beliefs: [],
						createdAt: Timestamp.now(),
						...persona
					})
				)
			);
			await setPhaseStatus(2, 'generated');
		} catch (e) {
			await setPhaseStatus(2, 'stopped');
			throw e;
		}
	};

	const generateChapters = async (): Promise<void> => {
		await setPhaseStatus(4, 'running');
		try {
			const generateChaptersCallable = httpsCallable<{ topicId: string }, unknown>(
				functions,
				'generateChapters',
				{ timeout: 300000 }
			);
			await generateChaptersCallable({ topicId });

			await setPhaseStatus(4, 'generated');
		} catch (e) {
			await setPhaseStatus(4, 'stopped');
			throw e;
		}
	};

	const startDebate = async (): Promise<void> => {
		const startDebateCallable = httpsCallable<{ topicId: string }, unknown>(
			functions,
			'startDebate',
			{ timeout: 600000 }
		);
		await startDebateCallable({ topicId });
	};

	// 停止した討論を currentChapterIndex から再開する。
	const restartDebate = async (): Promise<void> => {
		const restartDebateCallable = httpsCallable<{ topicId: string }, unknown>(
			functions,
			'restartDebate',
			{ timeout: 60000 }
		);
		await restartDebateCallable({ topicId });
	};

	// 討論の停止操作: トピックのフェーズ状態を停止にする。実行中のオーケストレータは
	// 次のターン境界でこれを読み自己停止する（在席非依存）。
	const stopDebate = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', topicId), {
			phaseStatus: 'stopped',
			updatedAt: Timestamp.now()
		});
	};

	return {
		get id() {
			return topic.id;
		},
		get title() {
			return topic.title;
		},
		get phase() {
			return topic.phase;
		},
		get phaseStatus() {
			return topic.phaseStatus;
		},
		get createdAt() {
			return topic.createdAt;
		},
		get updatedAt() {
			return topic.updatedAt;
		},
		get publishedAt() {
			return topic.publishedAt;
		},
		get personaCount() {
			return topic.personaCount;
		},
		get stakeholders() {
			return topic.stakeholders;
		},
		_set(data: TopicDoc) {
			topic = data;
		},
		generateStakeholders,
		generatePersonas,
		generateChapters,
		startDebate,
		restartDebate,
		stopDebate,
		resetStakeholders,
		resetPersonas,
		resetChapters,
		resetDebate,
		approveStakeholders,
		approveInterviews,
		approveChapters,
		publishDebate
	};
};

export type TopicStore = ReturnType<typeof createTopicStore>;
