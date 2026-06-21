import {
	doc,
	updateDoc,
	setDoc,
	Timestamp,
	getDocs,
	collection,
	deleteField,
	deleteDoc
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '$lib/firebase';
import type { TopicInput } from './topic.types';
import type { PersonaData } from '../persona/persona.types';
import type { Phase, PhaseStatus } from '$lib/models/phase/phase.types';

export const createTopicStates = (topicDoc: TopicInput) => {
	const id: string = $state(topicDoc.id);
	const title: string = $state(topicDoc.title);
	const phase: Phase = $state(topicDoc.phase);
	const phaseStatus: PhaseStatus = $state(topicDoc.phaseStatus);
	const description: string | undefined = $state(topicDoc.description);
	const sourceUrls: string[] | undefined = $state(topicDoc.sourceUrls);
	const fetchedSourceContents = $state(topicDoc.fetchedSourceContents);
	const personaCount: number = $state(topicDoc.personaCount ?? 0);
	const createdAt: Date = topicDoc.createdAt;
	const updatedAt: Date = topicDoc.updatedAt;
	const publishedAt: Date | undefined = topicDoc.publishedAt;

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
		await updateDoc(doc(db, 'topics', id), {
			personaCount,
			publishedAt: now,
			updatedAt: now
		});
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

	// ステークホルダー（stakeholders/0 ドキュメント）を削除する。
	const resetStakeholders = async (): Promise<void> => {
		await deleteDoc(doc(db, 'topics', id, 'stakeholders', '0'));
	};

	// ペルソナ（personas サブコレクション。取材記録・信念もペルソナ文書に含まれる）を全削除する。
	const resetPersonas = async (): Promise<void> => {
		const personasSnap = await getDocs(collection(db, 'topics', id, 'personas'));
		await Promise.all(personasSnap.docs.map((personaDoc) => deleteDoc(personaDoc.ref)));
	};

	// 章立て（chapters コレクションと chapterAnalysis/0）を消す。
	const resetChapters = async (): Promise<void> => {
		const chaptersSnap = await getDocs(collection(db, 'topics', id, 'chapters'));
		await Promise.all(chaptersSnap.docs.map((chapterDoc) => deleteDoc(chapterDoc.ref)));
		await deleteDoc(doc(db, 'topics', id, 'chapterAnalysis', '0'));
	};

	// 討論（chapters のターン・engagements・postDebateComments。章立ては残す）を消す。
	const resetDebate = async (): Promise<void> => {
		const chaptersSnap = await getDocs(collection(db, 'topics', id, 'chapters'));
		// engagements はペルソナidをキーにした討論時データ。各チャプター配下から全削除する。
		await Promise.all(
			chaptersSnap.docs.map(async (chapterDoc) => {
				const engagementsSnap = await getDocs(
					collection(db, 'topics', id, 'chapters', chapterDoc.id, 'engagements')
				);
				await Promise.all(
					engagementsSnap.docs.map((engagementDoc) => deleteDoc(engagementDoc.ref))
				);
			})
		);
		// postDebateComments を空にする
		await deleteDoc(doc(db, 'topics', id, 'postDebateComments', '0'));
		// 各チャプターのターン・論点状態・進行ステータスをリセットする
		await Promise.all(
			chaptersSnap.docs.map((chapterDoc) =>
				updateDoc(chapterDoc.ref, {
					turns: [],
					status: 'pending',
					discussionPointStatuses: deleteField()
				})
			)
		);
		// 討論中に蓄積したペルソナの信念変化（triggeredByTurnId 付き）を削除する
		const personasSnap = await getDocs(collection(db, 'topics', id, 'personas'));
		await Promise.all(
			personasSnap.docs.map((personaDoc) => {
				const beliefs: Array<{ triggeredByTurnId?: string | null }> =
					(personaDoc.data().beliefs as Array<{ triggeredByTurnId?: string | null }>) ?? [];
				const kept = beliefs.filter((b) => !b.triggeredByTurnId);
				if (kept.length !== beliefs.length) {
					return updateDoc(personaDoc.ref, { beliefs: kept });
				}
			})
		);
	};

	// --- 生成（各 generate は生成と書き込みのみ。旧データの削除は上の reset が担う） ---

	const generateStakeholders = async (): Promise<void> => {
		await setPhaseStatus(1, 'running');
		try {
			const generateStakeholdersCallable = httpsCallable<
				{ topicId: string; title: string },
				Record<string, never>
			>(functions, 'generateStakeholders', { timeout: 310000 });
			await generateStakeholdersCallable({ topicId: id, title });

			await updateDoc(doc(db, 'topics', id), {
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
			const generatePersonasCallable = httpsCallable<
				{ topicId: string; title: string },
				{ personas: Array<PersonaData & { id: string }> }
			>(functions, 'generatePersonas', { timeout: 310000 });
			const { data } = await generatePersonasCallable({
				topicId: id,
				title: title
			});

			await Promise.all(
				data.personas.map(({ id: personaId, ...persona }, index) =>
					setDoc(doc(db, 'topics', id, 'personas', personaId), {
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
		const restartDebateCallable = httpsCallable<
			{ topicId: string; singleChapterMode?: boolean },
			unknown
		>(functions, 'restartDebate', { timeout: 60000 });
		const singleChapterMode = import.meta.env.VITE_SINGLE_CHAPTER_MODE === 'true';
		await restartDebateCallable({ topicId: id, singleChapterMode: singleChapterMode || undefined });
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
		get description() {
			return description;
		},
		get sourceUrls() {
			return sourceUrls;
		},
		get fetchedSourceContents() {
			return fetchedSourceContents;
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
