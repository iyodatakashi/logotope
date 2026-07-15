import {
	doc,
	updateDoc,
	Timestamp,
	getDoc,
	getDocs,
	collection,
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

	// ペルソナ（一気通貫）を確定して章立て（chapters）フェーズへ前進させる。
	// 前進の前提「採用ペルソナ1件以上」の採用ゲートは呼び出し側（ペルソナ画面）が担保する。
	const advancePastPersonas = async (): Promise<void> => {
		await advancePhase('personas');
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

	// 未完成の記事要素（章／導入／締め／所感の1人）を種別ごとに個別再生成する共通入口。
	// 編集確定後（generated/stopped）のみ受け付けられ、実行中はサーバ側で拒否される。
	const regenerateArticleElement = async (element: ArticleElement): Promise<void> => {
		const regenerateCallable = httpsCallable<
			{ topicId: string; element: ArticleElement },
			{ topicId: string }
		>(functions, 'regenerateArticleElement', { timeout: 300000 });
		await regenerateCallable({ topicId: id, element });
	};

	// トピックを公開する。名前は publish だが、公開時点のペルソナ数を数え直して personaCount に焼き込む
	// （現状維持＋根拠・R7.4: personaCount は公開スナップショットの一部。公開確定と同一操作で再集計する設計）。
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

	// 進捗フェーズ（phase ポインタ）と状態（phaseStatus）をまとめてトピックへ書くヘルパー。
	// 名前どおり phase を遷移させる書き込みであることを明示する（状態のみの更新ではない・R7.1）。
	const setPhase = async (phase: PhaseSlug, phaseStatus: string): Promise<void> => {
		await updateDoc(doc(db, 'topics', id), {
			phase,
			phaseStatus,
			updatedAt: Timestamp.now()
		});
	};

	// --- 生成（各 generate はサーバ権威の単一操作。対象フェーズ確定・自層/下流破棄・生成/投入をサーバが所有する） ---

	const generateFactResearch = async (): Promise<void> => {
		await setPhase('fact-research', 'running');
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
				await setPhase('fact-research', 'stopped');
			}
			throw e;
		}
	};

	// ペルソナ生成の一気通貫（ステークホルダー→ペルソナ→全ペルソナ取材）をサーバ側で起動する。
	// フェーズの running 化・runId 発行・最初の段の投入はサーバ責務（在席非依存）。FE は起動を呼ぶだけ。
	// 再生成では呼び出し側が先に下流を reset してからこれを呼ぶ（新 runId で旧タスク id 衝突を回避）。
	const startPersonaGeneration = async (): Promise<void> => {
		const startPersonaGenerationCallable = httpsCallable<
			{ topicId: string },
			{ topicId: string }
		>(functions, 'startPersonaGeneration', { timeout: 60000 });
		await startPersonaGenerationCallable({ topicId: id });
	};

	const generateChapters = async (): Promise<void> => {
		await setPhase('chapters', 'running');
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
				await setPhase('chapters', 'stopped');
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
		startPersonaGeneration,
		generateChapters,
		startDebate,
		restartDebate,
		stopDebate,
		save,
		fetchSourceContents,
		approveTheme,
		approveFactResearch,
		advancePastPersonas,
		approveChapters,
		approveDebate,
		startEditing,
		regenerateArticleElement,
		publishDebate
	};
};

// 画面が扱う「生きたトピック」。アプリ層型 Topic に $state と各種操作を載せたもの。
export type TopicStates = ReturnType<typeof createTopicStates>;
