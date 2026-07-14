import {
	doc,
	updateDoc,
	Timestamp,
	getDoc,
	getDocs,
	collection,
	deleteDoc,
	deleteField
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '$lib/firebase';
import type { Topic } from './topic.types';
import type { ArticleElement } from '$lib/models/editorial/editorial.types';
import type { PhaseSlug, PhaseStatus } from '$lib/models/phase/phase.types';
import { nextPhase } from '$lib/models/phase/phase';

export const createTopicStates = (topicDoc: Topic) => {
	const id: string = $state(topicDoc.id);
	// 題名・説明・参考URLは画面から直接編集できる（bind 可能）。永続化は save を明示的に呼ぶ。
	// 未設定は空文字・空配列で表す（Firestore 上のフィールド不在は save が deleteField で表現する）。
	let title: string = $state(topicDoc.title);
	let description: string = $state(topicDoc.description ?? '');
	let sourceUrls: string[] = $state(topicDoc.sourceUrls ?? []);
	const phase: PhaseSlug = $state(topicDoc.phase);
	const phaseStatus: PhaseStatus = $state(topicDoc.phaseStatus);
	const fetchedSourceContents = $state(topicDoc.fetchedSourceContents);
	const personaCount: number = $state(topicDoc.personaCount ?? 0);
	const createdAt: Date = topicDoc.createdAt;
	const updatedAt: Date = topicDoc.updatedAt;
	const publishedAt: Date | undefined = topicDoc.publishedAt;

	// 現在フェーズを承認し、定義配列の次フェーズへ前進させる（最終フェーズでは前進しない）。
	const advancePhase = async (currentKey: PhaseSlug): Promise<void> => {
		const next = nextPhase(currentKey);
		if (!next) return;
		await updateDoc(doc(db, 'topics', id), {
			phase: next,
			phaseStatus: 'not_started',
			updatedAt: Timestamp.now()
		});
	};

	// 編集中の内容（題名・説明・参考URL）を永続化する。
	// 空の説明・URLはフィールドごと消して未設定に戻す。空題名は保存せず永続済みの題名へ戻す。
	const save = async (): Promise<void> => {
		const trimmedTitle = title.trim();
		if (!trimmedTitle) {
			title = topicDoc.title;
			return;
		}
		title = trimmedTitle;
		const urls = $state.snapshot(sourceUrls).filter((url) => url.trim());
		await updateDoc(doc(db, 'topics', id), {
			title: trimmedTitle,
			description: description.trim() ? description : deleteField(),
			sourceUrls: urls.length ? urls : deleteField(),
			updatedAt: Timestamp.now()
		});
	};

	// 参考URLの本文を取得する（fetchedSourceContents はサーバが書く）。
	const fetchSourceContents = async (): Promise<void> => {
		const fetchSourceContentsCallable = httpsCallable<{ topicId: string }, unknown>(
			functions,
			'fetchSourceContents'
		);
		await fetchSourceContentsCallable({ topicId: id });
	};

	// テーマを確定して事実リサーチフェーズへ前進させる。
	const approveTheme = async (): Promise<void> => {
		await advancePhase('theme');
	};

	// 事実リサーチを確定してステークホルダーフェーズへ前進させる。
	// 実行せず承認した場合も空の事実基盤（factBase/0 不在＝空）で同じ前進経路を通る。
	const approveFactResearch = async (): Promise<void> => {
		await advancePhase('fact-research');
	};

	const approveStakeholders = async (): Promise<void> => {
		await advancePhase('stakeholders');
	};

	const approveInterviews = async (): Promise<void> => {
		await advancePhase('interviews');
	};

	const approveChapters = async (): Promise<void> => {
		await advancePhase('chapters');
	};

	// 討論を確定して編集フェーズへ前進させる。討論 generated のときのみ画面から到達できる。
	const approveDebate = async (): Promise<void> => {
		await advancePhase('debate');
	};

	// 編集を開始する（既存成果物破棄→実行中化→章チェーン投入はサーバ責務）。
	const startEditing = async (): Promise<void> => {
		const startEditingCallable = httpsCallable<{ topicId: string }, { topicId: string }>(
			functions,
			'startEditing',
			{ timeout: 60000 }
		);
		await startEditingCallable({ topicId: id });
	};

	// 編集を未実行状態へ戻す（成果物破棄＋編集フェーズを not_started に）。原本は不変。
	const resetEditing = async (): Promise<void> => {
		const resetEditingCallable = httpsCallable<{ topicId: string }, { topicId: string }>(
			functions,
			'resetEditing'
		);
		await resetEditingCallable({ topicId: id });
	};

	// 未完成の記事要素（章／導入／締め／所感の1人）を種別ごとに個別再生成する共通入口。
	// 編集確定後（generated/stopped）のみ受け付けられ、実行中はサーバ側で拒否される。
	const regenerateArticleElement = async (element: ArticleElement): Promise<void> => {
		const regenerateCallable = httpsCallable<
			{ topicId: string; element: ArticleElement },
			{ topicId: string }
		>(functions, 'regenerateArticleElement', { timeout: 300000 });
		await regenerateCallable({ topicId: id, element });
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
	const setPhaseStatus = async (phase: PhaseSlug, phaseStatus: string): Promise<void> => {
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

	// 討論（chapters のターン・engagements。章立ては残す）を消す。編集記事（editorial/editedChapters）は
	// サーバの resetDebate が原本再生成との不整合を残さないよう破棄する。
	// 章付随データの削除責務はサーバへ集約済み。FE は onCall を呼ぶだけにする（クライアント側で個別削除しない）。
	const resetDebate = async (): Promise<void> => {
		const resetDebateCallable = httpsCallable<{ topicId: string }, { topicId: string }>(
			functions,
			'resetDebate'
		);
		await resetDebateCallable({ topicId: id });
	};

	// --- 生成（各 generate は生成と書き込みのみ。旧データの削除は上の reset が担う） ---

	const generateFactResearch = async (): Promise<void> => {
		await setPhaseStatus('fact-research', 'running');
		try {
			const generateFactResearchCallable = httpsCallable<
				{ topicId: string; title: string },
				Record<string, never>
			>(functions, 'generateFactResearch', { timeout: 310000 });
			await generateFactResearchCallable({ topicId: id, title });
			// 完了状態(phaseStatus='generated')はサーバが権威的に書くため、ここでは書かない。
		} catch (e) {
			// サーバが既に generated を確定済み（クライアントのタイムアウト等で reject されただけ）の
			// 場合は stopped に上書きしない。承認ボタンが消える不具合の再発を防ぐ。
			const snap = await getDoc(doc(db, 'topics', id));
			if (snap.data()?.phaseStatus !== 'generated') {
				await setPhaseStatus('fact-research', 'stopped');
			}
			throw e;
		}
	};

	const generateStakeholders = async (): Promise<void> => {
		await setPhaseStatus('stakeholders', 'running');
		try {
			const generateStakeholdersCallable = httpsCallable<
				{ topicId: string; title: string },
				Record<string, never>
			>(functions, 'generateStakeholders', { timeout: 310000 });
			await generateStakeholdersCallable({ topicId: id, title });
			// 完了状態(phaseStatus='generated')はサーバが権威的に書くため、ここでは書かない。
		} catch (e) {
			// サーバが既に generated を確定済み（クライアントのタイムアウト等で reject されただけ）の
			// 場合は stopped に上書きしない。承認ボタンが消える不具合の再発を防ぐ。
			const snap = await getDoc(doc(db, 'topics', id));
			if (snap.data()?.phaseStatus !== 'generated') {
				await setPhaseStatus('stakeholders', 'stopped');
			}
			throw e;
		}
	};

	// selectedStakeholderIds は採用（チェックON）ステークホルダーの安定 id 集合。
	// サーバはこの部分集合のみを対象にペルソナを生成し、各ペルソナへ由来 stakeholderId を付与する。
	const generatePersonas = async (selectedStakeholderIds: string[]): Promise<void> => {
		await setPhaseStatus('personas', 'running');
		try {
			const generatePersonasCallable = httpsCallable<
				{ topicId: string; title: string; selectedStakeholderIds: string[] },
				Record<string, never>
			>(functions, 'generatePersonas', { timeout: 310000 });
			await generatePersonasCallable({ topicId: id, title, selectedStakeholderIds });
			// ペルソナ文書の永続化と完了状態(phaseStatus='generated')はサーバが権威的に書くため、
			// ここでは書かない。FE は onSnapshot で一覧と完了状態を反映する。
		} catch (e) {
			// サーバが既に generated を確定済み（クライアントのタイムアウト等で reject されただけ）の
			// 場合は stopped に上書きしない。承認ボタンが消える不具合の再発を防ぐ。
			const snap = await getDoc(doc(db, 'topics', id));
			if (snap.data()?.phaseStatus !== 'generated') {
				await setPhaseStatus('personas', 'stopped');
			}
			throw e;
		}
	};

	const generateChapters = async (): Promise<void> => {
		await setPhaseStatus('chapters', 'running');
		try {
			const generateChaptersCallable = httpsCallable<{ topicId: string }, unknown>(
				functions,
				'generateChapters',
				{ timeout: 540000 }
			);
			await generateChaptersCallable({ topicId: id });
			// 完了状態(phaseStatus='generated')はサーバが権威的に書くため、ここでは書かない。
		} catch (e) {
			// サーバが既に generated を確定済み（クライアントのタイムアウト等で reject されただけ）の
			// 場合は stopped に上書きしない。承認ボタンが消える不具合の再発を防ぐ。
			const snap = await getDoc(doc(db, 'topics', id));
			if (snap.data()?.phaseStatus !== 'generated') {
				await setPhaseStatus('chapters', 'stopped');
			}
			throw e;
		}
	};

	const startDebate = async (singleChapterMode?: boolean): Promise<void> => {
		const startDebateCallable = httpsCallable<
			{ topicId: string; singleChapterMode?: boolean },
			unknown
		>(functions, 'startDebate', { timeout: 600000 });
		await startDebateCallable({ topicId: id, singleChapterMode: singleChapterMode || undefined });
	};

	// 停止した討論を currentChapterIndex から再開する。
	const restartDebate = async (singleChapterMode?: boolean): Promise<void> => {
		const restartDebateCallable = httpsCallable<
			{ topicId: string; singleChapterMode?: boolean },
			unknown
		>(functions, 'restartDebate', { timeout: 60000 });
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
		set title(value: string) {
			title = value;
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
		set description(value: string) {
			description = value;
		},
		get sourceUrls() {
			return sourceUrls;
		},
		set sourceUrls(value: string[]) {
			sourceUrls = value;
		},
		get fetchedSourceContents() {
			return fetchedSourceContents;
		},

		generateFactResearch,
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
		save,
		fetchSourceContents,
		approveTheme,
		approveFactResearch,
		approveStakeholders,
		approveInterviews,
		approveChapters,
		approveDebate,
		startEditing,
		resetEditing,
		regenerateArticleElement,
		publishDebate
	};
};

// 画面が扱う「生きたトピック」。アプリ層型 Topic に $state と各種操作を載せたもの。
export type TopicStates = ReturnType<typeof createTopicStates>;
