import { getFirestore } from 'firebase-admin/firestore';
import { clearEditorial } from './editorial-repository.js';
import { clearDigestCache } from './digest-cache-repository.js';
import type { EditedChapterForFirestore } from '../../types/chapter.types.js';

// 本体(章)の編集後 editedChapters の read/write/clear。導入・締め・所感は editorial-repository（editorial/outputs）が担う。
// 生ディベート（chapters）とは別コレクションに保存し、原本は一切変更しない。

const db = () => getFirestore();

const editedChaptersRef = (topicId: string) => db().collection(`topics/${topicId}/editedChapters`);

/** 編集後章を書き込む（chapterId は原本と共有・冪等上書き）。status で完了/失敗を表す */
export const writeEditedChapter = async (
	topicId: string,
	chapterId: string,
	chapter: EditedChapterForFirestore
): Promise<void> => {
	await editedChaptersRef(topicId).doc(chapterId).set(chapter);
};

/** 編集後章を chapterIndex 昇順で読み取る（完了確定・進捗集計用） */
export const readEditedChapters = async (topicId: string): Promise<EditedChapterForFirestore[]> => {
	const snap = await editedChaptersRef(topicId).orderBy('chapterIndex').get();
	return snap.docs.map((docSnap) => docSnap.data() as EditedChapterForFirestore);
};

/**
 * 編集成果物一式（全 editedChapters ＋ 統合保存 editorial/outputs）を破棄する。原本は不変。
 * 併せて討論ダイジェストのキャッシュ（editorial/digest）も削除して無効化する（案A・R5.3）。
 * これにより上流変更（討論・ペルソナ・章・fact）・編集ラン開始のすべてでダイジェストが作り直される。
 */
export const clearEditedArtifact = async (topicId: string): Promise<void> => {
	const snap = await editedChaptersRef(topicId).get();
	for (const docSnap of snap.docs) {
		await docSnap.ref.delete();
	}
	await clearEditorial(topicId);
	await clearDigestCache(topicId);
};
