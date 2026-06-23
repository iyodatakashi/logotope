import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { DebateState, DiscussionPointState } from '../../types/debate.types.js';
import type { Chapter } from '../../types/chapter.types.js';

const db = () => getFirestore();

/** 章の論点をすべて untouched 状態で初期化する（論点を持たない章は空配列） */
export const initDiscussionPoints = (chapter: Chapter): DiscussionPointState[] =>
	(chapter.discussionPoints ?? []).map((point) => ({
		point,
		status: 'untouched' as const
	}));

/**
 * オープニング/導入で提示した論点を introduced に更新する。
 * index は「未消化(addressed でない)論点リスト」上の位置なので、そこから実体を引いて状態を変える。
 */
export const markIntroduced = (state: DebateState, index: number | undefined): void => {
	if (index === undefined) return;
	const untouched = state.discussionPoints.filter((p) => p.status !== 'addressed');
	const target =
		untouched[index] !== undefined
			? state.discussionPoints.find((p) => p.point === untouched[index].point)
			: undefined;
	if (target) target.status = 'introduced';
};

/** 再確認で実は議論済みと判定された論点を addressed に更新する */
export const markAddressed = (state: DebateState, point: string): void => {
	const target = state.discussionPoints.find((p) => p.point === point);
	if (target) target.status = 'addressed';
};

/** 章ドキュメントに論点ステータス（point/status）を書き込む。論点を持たない章では何もしない */
export const saveDiscussionPointStatuses = async (
	topicId: string,
	chapterId: string,
	state: DebateState
): Promise<void> => {
	if (state.discussionPoints.length === 0) return;
	await db()
		.doc(`topics/${topicId}/chapters/${chapterId}`)
		.update({
			discussionPointStatuses: state.discussionPoints.map((p) => ({
				point: p.point,
				status: p.status
			}))
		});
};

/** 章完了時に論点ステータスのフィールドごと削除する（クリーンアップ） */
export const deleteDiscussionPointStatuses = async (
	topicId: string,
	chapterId: string
): Promise<void> => {
	await db().doc(`topics/${topicId}/chapters/${chapterId}`).update({
		discussionPointStatuses: FieldValue.delete()
	});
};
