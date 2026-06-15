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
import { db, functions } from '$lib/firebase';
import type { TopicDoc, StakeholderDoc } from './topic.types';
import type { PersonaData } from '../persona/persona.types';
import type { Phase, PhaseStatus } from '$lib/models/phase/phase.types';

export const createTopicStates = (topicDoc: TopicDoc) => {
	let id: string = $state(topicDoc.id);
	let title: string = $state(topicDoc.title);
	let phase: Phase = $state(topicDoc.phase);
	let phaseStatus: PhaseStatus = $state(topicDoc.phaseStatus);
	let stakeholders: StakeholderDoc[] = $state(topicDoc.stakeholders ?? []);
	let personaCount: number = $state(topicDoc.personaCount ?? 0);
	let createdAt: Date = topicDoc.createdAt.toDate();
	let updatedAt: Date = topicDoc.updatedAt.toDate();
	let publishedAt: Date | undefined = topicDoc.publishedAt?.toDate();

	const approveStakeholders = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', id), {
			phase: 2,
			phaseStatus: 'not_started',
			updatedAt: Timestamp.now()
		});
	};

	const approveInterviews = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', id), {
			phase: 4,
			phaseStatus: 'not_started',
			updatedAt: Timestamp.now()
		});
	};

	const approveChapters = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', id), {
			phase: 5,
			phaseStatus: 'not_started',
			updatedAt: Timestamp.now()
		});
	};

	const publishDebate = async (): Promise<void> => {
		const personasSnap = await getDocs(collection(db, 'topics', id, 'personas'));
		const personaCount = personasSnap.size;
		const now = Timestamp.now();
		const batch = writeBatch(db);
		batch.update(doc(db, 'topics', id), {
			personaCount,
			publishedAt: now,
			updatedAt: now
		});
		batch.update(doc(db, 'topics', id, 'sessions', '0'), {
			publishedAt: now
		});
		await batch.commit();
	};

	// フェーズ状態（実行中・生成完了・停止）をトピックに書く小さなヘルパー。
	const setPhaseStatus = async (phase: 1 | 2 | 3 | 4 | 5, phaseStatus: string): Promise<void> => {
		await updateDoc(doc(db, 'topics', id), {
			phase,
			phaseStatus,
			updatedAt: Timestamp.now()
		});
	};

	// --- 旧データのリセット（データ層ごと。各 reset はその層のデータだけを消す） ---
	// 再生成では、各フェーズ画面の regenerate ハンドラが「自フェーズ＋下流ぶん」を合成して呼ぶ。

	// ステークホルダー（トピックの stakeholders フィールド）を空に戻す。
	const resetStakeholders = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', id), {
			stakeholders: [],
			updatedAt: Timestamp.now()
		});
	};

	// ペルソナ（personas サブコレクション。取材記録・信念もペルソナ文書に含まれる）を全削除する。
	const resetPersonas = async (): Promise<void> => {
		const personasSnap = await getDocs(collection(db, 'topics', id, 'personas'));
		await Promise.all(personasSnap.docs.map((personaDoc) => deleteDoc(personaDoc.ref)));
	};

	// 章立て（セッションの chapters）を消す。session '0' 未作成でも安全なよう merge で書く。
	const resetChapters = async (): Promise<void> => {
		await setDoc(
			doc(db, 'topics', id, 'sessions', '0'),
			{ chapters: deleteField(), chapterIssues: deleteField() },
			{ merge: true }
		);
	};

	// 討論（セッションの turns・進行状態・発言意欲。章立ては残す）を消す。session '0' 未作成でも安全。
	const resetDebate = async (): Promise<void> => {
		// engagements はペルソナidをキーにした討論時データ。古いペルソナidが残らないよう全削除する。
		const engagementsSnap = await getDocs(
			collection(db, 'topics', id, 'sessions', '0', 'engagements')
		);
		await Promise.all(engagementsSnap.docs.map((engagementDoc) => deleteDoc(engagementDoc.ref)));
		await setDoc(
			doc(db, 'topics', id, 'sessions', '0'),
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
			const { data } = await generateStakeholdersCallable({ title });

			await updateDoc(doc(db, 'topics', id), {
				stakeholders: data.stakeholders,
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
			const stakeholderItems = stakeholders ?? [];
			const generatePersonasCallable = httpsCallable<
				{ title: string; stakeholders: StakeholderDoc[] },
				{ personas: PersonaData[] }
			>(functions, 'generatePersonas', { timeout: 310000 });
			const { data } = await generatePersonasCallable({
				title: title,
				stakeholders: stakeholderItems
			});

			await Promise.all(
				data.personas.map((persona, index) =>
					addDoc(collection(db, 'topics', id, 'personas'), {
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
			await generateChaptersCallable({ topicId: id });

			await setPhaseStatus(4, 'generated');
		} catch (e) {
			await setPhaseStatus(4, 'stopped');
			throw e;
		}
	};

	const startDebate = async (): Promise<void> => {
		const startDebateCallable = httpsCallable<
			{ topicId: string; singleChapterMode?: boolean },
			unknown
		>(functions, 'startDebate', { timeout: 600000 });
		const singleChapterMode = import.meta.env.VITE_SINGLE_CHAPTER_MODE === 'true';
		await startDebateCallable({ topicId: id, singleChapterMode: singleChapterMode || undefined });
	};

	// 停止した討論を currentChapterIndex から再開する。
	const restartDebate = async (): Promise<void> => {
		const restartDebateCallable = httpsCallable<{ topicId: string }, unknown>(
			functions,
			'restartDebate',
			{ timeout: 60000 }
		);
		await restartDebateCallable({ topicId: id });
	};

	// 討論の停止操作: トピックのフェーズ状態を停止にする。実行中のオーケストレータは
	// 次のターン境界でこれを読み自己停止する（在席非依存）。
	const stopDebate = async (): Promise<void> => {
		await updateDoc(doc(db, 'topics', id), {
			phaseStatus: 'stopped',
			updatedAt: Timestamp.now()
		});
	};

	return {
		get id() {
			return id;
		},
		get title() {
			return title;
		},
		get phase() {
			return phase;
		},
		get phaseStatus() {
			return phaseStatus;
		},
		get createdAt() {
			return createdAt;
		},
		get updatedAt() {
			return updatedAt;
		},
		get publishedAt() {
			return publishedAt;
		},
		get personaCount() {
			return personaCount;
		},
		get stakeholders() {
			return stakeholders;
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

export type Topic = ReturnType<typeof createTopicStates>;
