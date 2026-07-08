import { getFirestore } from 'firebase-admin/firestore';
import type {
	EditorialForFirestore,
	Narration,
	ImpressionForFirestore
} from '../../types/editorial.types.js';

// 導入・締め・所感を1つにまとめた統合ドキュメント editorial/0 の読み取りと部分上書き（blind write）。
// 各 set は対象項目だけを書き、ドキュメント全体を読み直さず他要素を読み書きしない。
// 別々の項目への更新は同時でも衝突しない（R6.2）。原本（討論生データ）は一切変更しない。

const db = () => getFirestore();

const editorialRef = (topicId: string) => db().doc(`topics/${topicId}/editorial/0`);

const emptyNarration = (): Narration => ({ draft: null, final: null });

/** 統合ドキュメントを読み取る。欠落項目は空（draft/final=null・impressions={}）で補完して返す */
export const readEditorial = async (topicId: string): Promise<EditorialForFirestore> => {
	const snap = await editorialRef(topicId).get();
	const data = snap.exists ? (snap.data() as Partial<EditorialForFirestore>) : {};
	return {
		intro: data.intro ?? emptyNarration(),
		outro: data.outro ?? emptyNarration(),
		impressions: data.impressions ?? {}
	};
};

/** 導入を部分上書きする（intro 項目のみ・他要素不変） */
export const setIntro = async (
	topicId: string,
	part: Narration
): Promise<void> => {
	await editorialRef(topicId).update({ intro: part });
};

/** 締めを部分上書きする（outro 項目のみ・他要素不変） */
export const setOutro = async (
	topicId: string,
	part: Narration
): Promise<void> => {
	await editorialRef(topicId).update({ outro: part });
};

/** 所感1人分を personaId キーで部分上書きする（当該ペルソナのみ・他要素不変） */
export const setImpression = async (
	topicId: string,
	personaId: string,
	part: ImpressionForFirestore
): Promise<void> => {
	await editorialRef(topicId).update({ [`impressions.${personaId}`]: part });
};

/**
 * 統合ドキュメントを初期化する（編集開始・やり直し時の破棄）。
 * 基底ドキュメントを作り、以降の各要素の部分上書きを可能にする。
 */
export const clearEditorial = async (topicId: string): Promise<void> => {
	await editorialRef(topicId).set({
		intro: emptyNarration(),
		outro: emptyNarration(),
		impressions: {}
	});
};
