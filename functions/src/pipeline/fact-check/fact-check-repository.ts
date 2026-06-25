import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import type {
	FactCheckFinding,
	FactCheckResultForFirestore
} from '../../types/fact-check.types.js';
import type { SearchResult } from '../../search/grounding.js';

const db = () => getFirestore();

const resultRef = (topicId: string, chapterId: string) =>
	db().doc(`topics/${topicId}/chapters/${chapterId}/factCheck/result`);

/** 実行開始時に既存結果を削除してから running を書く（1.5, 4.3） */
export const startFactCheckResult = async (topicId: string, chapterId: string): Promise<void> => {
	const ref = resultRef(topicId, chapterId);
	await ref.delete();
	await ref.set({
		chapterId,
		status: 'running',
		findings: [],
		sources: [],
		startedAt: Timestamp.now()
	});
};

/** 1発言ぶんの指摘・出典を結果ドキュメントへ追記する（逐次表示用。完了を待たずに反映される） */
export const appendFactCheckFindings = async (
	topicId: string,
	chapterId: string,
	findings: FactCheckFinding[],
	sources: SearchResult[]
): Promise<void> => {
	if (findings.length === 0 && sources.length === 0) return;
	const update: Record<string, unknown> = {};
	if (findings.length > 0) update.findings = FieldValue.arrayUnion(...findings);
	// 出典は章全体で重複しうるため arrayUnion で重複排除しながら蓄積する
	if (sources.length > 0) update.sources = FieldValue.arrayUnion(...sources);
	await resultRef(topicId, chapterId).update(update);
};

/** 全発言の検証が終わったら completed に遷移する（findings は逐次追記済み）（4.1） */
export const markFactCheckCompleted = async (topicId: string, chapterId: string): Promise<void> => {
	await resultRef(topicId, chapterId).update({
		status: 'completed',
		completedAt: Timestamp.now()
	});
};

/** 実行失敗時に failed とエラーメッセージを記録する（6.1） */
export const failFactCheckResult = async (
	topicId: string,
	chapterId: string,
	errorMessage: string
): Promise<void> => {
	await resultRef(topicId, chapterId).update({
		status: 'failed',
		errorMessage,
		completedAt: Timestamp.now()
	});
};

export const readFactCheckResult = async (
	topicId: string,
	chapterId: string
): Promise<FactCheckResultForFirestore | null> => {
	const snap = await resultRef(topicId, chapterId).get();
	if (!snap.exists) return null;
	return snap.data() as FactCheckResultForFirestore;
};

export const deleteFactCheckResult = async (topicId: string, chapterId: string): Promise<void> => {
	await resultRef(topicId, chapterId).delete();
};
