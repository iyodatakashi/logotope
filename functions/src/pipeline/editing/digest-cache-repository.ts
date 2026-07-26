import { getFirestore } from 'firebase-admin/firestore';
import type { DebateDigest } from '../../types/debate-digest.types.js';

// 討論ダイジェスト（DebateDigest）をサーバー内専用のキャッシュとして topics/{id}/editorial/digest に保存する。
// 討論が変わらない限り導入・締めの再生成で作り直さないための保存先（blind write・トランザクション不使用）。
// このドキュメントは FE に購読させない（成果物 editorial/outputs とは別ドキュメントに分離）。無効化は
// clearEditedArtifact 経由の clearDigestCache に一元化する（上流変更・編集ラン開始で作り直させる）。

const db = () => getFirestore();

const digestRef = (topicId: string) => db().doc(`topics/${topicId}/editorial/digest`);

/** 保存済みダイジェストを読む。未保存なら null を返す */
export const readDigestCache = async (topicId: string): Promise<DebateDigest | null> => {
	const snap = await digestRef(topicId).get();
	return snap.exists ? (snap.data() as DebateDigest) : null;
};

/** ダイジェストを単一書き込みで上書き保存する（DebateDigest と同一の形・追加フィールドを混ぜない） */
export const writeDigestCache = async (topicId: string, digest: DebateDigest): Promise<void> => {
	await digestRef(topicId).set(digest);
};

/** ダイジェストキャッシュを削除する（未存在でも成功・冪等） */
export const clearDigestCache = async (topicId: string): Promise<void> => {
	await digestRef(topicId).delete();
};
