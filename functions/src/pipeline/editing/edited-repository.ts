import { getFirestore } from 'firebase-admin/firestore';
import type {
	EditedChapterForFirestore,
	EditedPostDebateCommentsForFirestore,
	EditedIntroClosingForFirestore
} from '../../types/editorial.types.js';

// 編集成果物（editedChapters / editedPostDebateComments）の read/write/clear。
// 生ディベート（chapters / postDebateComments）とは別コレクションに保存し、原本は一切変更しない。

const db = () => getFirestore();

const editedChaptersRef = (topicId: string) => db().collection(`topics/${topicId}/editedChapters`);

const editedCommentsRef = (topicId: string) =>
	db().doc(`topics/${topicId}/editedPostDebateComments/0`);

const editedIntroClosingRef = (topicId: string) =>
	db().doc(`topics/${topicId}/editedIntroClosing/0`);

/** 編集後章を書き込む（chapterId は原本と共有・冪等上書き）。status で完了/失敗を表す */
export const writeEditedChapter = async (
	topicId: string,
	chapterId: string,
	chapter: EditedChapterForFirestore
): Promise<void> => {
	await editedChaptersRef(topicId).doc(chapterId).set(chapter);
};

/** 編集後コメントを書き込む（editedPostDebateComments/0・冪等上書き） */
export const writeEditedComments = async (
	topicId: string,
	comments: EditedPostDebateCommentsForFirestore
): Promise<void> => {
	await editedCommentsRef(topicId).set(comments);
};

/** 編集後章を chapterIndex 昇順で読み取る（完了確定・進捗集計用） */
export const readEditedChapters = async (topicId: string): Promise<EditedChapterForFirestore[]> => {
	const snap = await editedChaptersRef(topicId).orderBy('chapterIndex').get();
	return snap.docs.map((docSnap) => docSnap.data() as EditedChapterForFirestore);
};

/** イントロ・クロージング成果物を書き込む（editedIntroClosing/0・冪等上書き） */
export const writeEditedIntroClosing = async (
	topicId: string,
	introClosing: EditedIntroClosingForFirestore
): Promise<void> => {
	await editedIntroClosingRef(topicId).set(introClosing);
};

/** イントロ・クロージング成果物を読み取る（未生成なら null） */
export const readEditedIntroClosing = async (
	topicId: string
): Promise<EditedIntroClosingForFirestore | null> => {
	const snap = await editedIntroClosingRef(topicId).get();
	return snap.exists ? (snap.data() as EditedIntroClosingForFirestore) : null;
};

/** 編集成果物一式（全 editedChapters ＋ editedPostDebateComments ＋ editedIntroClosing）を破棄する。原本は不変 */
export const clearEditedArtifact = async (topicId: string): Promise<void> => {
	const snap = await editedChaptersRef(topicId).get();
	for (const docSnap of snap.docs) {
		await docSnap.ref.delete();
	}
	await editedCommentsRef(topicId).set({ comments: [] });
	await editedIntroClosingRef(topicId).set({ intro: null, closing: null });
};
