import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { DebateState } from '../../types/debate.types.js';
import type { DiscussionPointState } from '../../types/chapter.types.js';
import type { Chapter } from '../../types/chapter.types.js';

const db = () => getFirestore();

/** 章の論点をすべて untouched 状態で初期化する（論点を持たない章は空配列） */
export const initDiscussionPoints = (chapter: Chapter): DiscussionPointState[] =>
	(chapter.discussionPoints ?? []).map((point) => ({
		point,
		status: 'untouched' as const
	}));

/**
 * state から最新に提示された論点（introduced のうち introducedOrder 最大）を一意に解決する。
 * 提示済みが無ければ undefined を返す。title フォールバックは呼び出し側の責務（純関数・state 不変）。
 */
export const getActiveDiscussionPoint = (state: DebateState): string | undefined => {
	const introduced = state.discussionPoints.filter((p) => p.status === 'introduced');
	if (introduced.length === 0) return undefined;
	return introduced.reduce((latest, p) =>
		(p.introducedOrder ?? 0) > (latest.introducedOrder ?? 0) ? p : latest
	).point;
};

/**
 * オープニング/導入・介入で提示した論点を introduced に更新する。提示遷移の唯一の経路。
 * index は「未提示(untouched)論点リスト」上の位置なので、そこから実体を引いて状態を変える。
 */
export const markIntroduced = (state: DebateState, index: number | undefined): void => {
	if (index === undefined) return;
	const untouched = state.discussionPoints.filter((p) => p.status === 'untouched');
	const target =
		untouched[index] !== undefined
			? state.discussionPoints.find((p) => p.point === untouched[index].point)
			: undefined;
	if (!target) return;
	// 直近に提示された論点を一意に追えるよう、提示のたびに単調増加の順序を採番する
	const maxOrder = state.discussionPoints.reduce(
		(max, p) => Math.max(max, p.introducedOrder ?? 0),
		0
	);
	target.status = 'introduced';
	target.introducedOrder = maxOrder + 1;
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
				status: p.status,
				...(p.introducedOrder !== undefined ? { introducedOrder: p.introducedOrder } : {})
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
