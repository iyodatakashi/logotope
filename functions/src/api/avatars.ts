import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { requireAuth } from '../utils/auth.js';
import { generateAvatarAsset, type AvatarSpec } from '../avatar/avatar-engine.js';
import type { Persona } from '../types/persona.types.js';

// アバター生成の本番経路。唯一の生成実装（共有エンジン generateAvatarAsset）を呼ぶ薄い実行アダプタで、
// Firestore 読み・Storage 保存・生成時刻の lifecycle だけをここが持つ（生成そのものはエンジン・Req 1.4）。
//
// runAvatarCore: persona 読み → 生成時刻を即時削除 → エンジン生成 → Storage 保存 → 生成時刻記録。
// androgynous（seed 無し）・生成失敗・例外は生成時刻を未設定のまま残し、握りつぶして討論生成を止めない
// （欠落は未生成として観測でき、管理画面の個別再生成〈regenerateAvatar〉やバックフィルで回収する）。

const db = () => getFirestore();

// 保存先バケット。表示側（PersonaAvatar.svelte）が読むバケットと同一にする必要がある。
// アプリの storageBucket（deploy 時は FIREBASE_CONFIG、バックフィルは initializeApp 引数）で解決するため
// バケット名はコードに焼き込まない。
const bucket = () => getStorage().bucket();

// 表示側と同一のオブジェクトパス（拡張子なし）。storage.rules の avatars 公開読みもこのパスに一致する。
const avatarObjectPath = (topicId: string, personaId: string): string =>
	`topics/${topicId}/avatars/${personaId}`;

/**
 * 1ペルソナのアバターを生成し保存する。本番と検証が同じエンジンだけを通る（乖離不能・Req 1.4）。
 * 開始時に avatarGeneratedAt を即時削除する（再生成時に古い画像が残らず既定アバターへ縮退する UX・
 * 整合性は副次）。適合 seed 無し（androgynous）・生成失敗・例外は生成時刻を未設定のまま残す。
 */
export const runAvatarCore = async (topicId: string, personaId: string): Promise<void> => {
	const ref = db().doc(`topics/${topicId}/personas/${personaId}`);
	try {
		const snap = await ref.get();
		if (!snap.exists) return;
		const persona = snap.data() as Persona;

		// 生成開始時に旧アバターの生成時刻を即時削除する（表示は即座に既定アバターへ縮退）。
		await ref.update({ avatarGeneratedAt: FieldValue.delete() });

		// gender（性自認）は渡さない。エンジンが使うのは外観（genderPresentation）のみ（Req 3.7）。
		const spec: AvatarSpec = {
			age: persona.age,
			genderPresentation: persona.genderPresentation,
			occupation: persona.occupation
		};
		const result = await generateAvatarAsset(spec);
		// no_seed（androgynous）・generation_failed は未生成のまま残す。
		if (!result.ok) return;

		await bucket()
			.file(avatarObjectPath(topicId, personaId))
			.save(Buffer.from(result.asset), { contentType: 'image/png', resumable: false });

		// 保存成功後にだけ生成時刻を記録する（存在フラグ兼キャッシュバスター）。
		await ref.update({ avatarGeneratedAt: Timestamp.now() });
	} catch (err) {
		// 失敗は握りつぶして討論生成を止めない（欠落は個別再生成・バックフィルで回収）。
		console.error('[runAvatarCore] error', { topicId, personaId }, err);
	}
};

/**
 * 管理画面からの個別再生成（onCall）。認証のうえ runAvatarCore を呼ぶ。
 * runAvatarCore が開始時に生成時刻を即時削除し、seed・可変軸は毎回ランダムに引かれるため、
 * 再生成のたびに別の seed／軸のアバターへ置き換わる（決定的でない＝作り直すと別物になる）。
 * 生成時刻の有無で成否を返す（core は失敗を握って戻るため）。
 */
export const regenerateAvatar = onCall({ timeoutSeconds: 120 }, async (request) => {
	requireAuth(request);
	const { topicId, personaId } = request.data as { topicId?: string; personaId?: string };
	if (!topicId?.trim() || !personaId?.trim())
		throw new HttpsError('invalid-argument', 'topicId and personaId are required');

	await runAvatarCore(topicId, personaId);
	const after = await db().doc(`topics/${topicId}/personas/${personaId}`).get();
	return { topicId, personaId, generated: !!after.data()?.avatarGeneratedAt };
});
