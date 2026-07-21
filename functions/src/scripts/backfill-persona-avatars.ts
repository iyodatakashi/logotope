/**
 * Migration: 既存ペルソナのアバター画像を、新規と同じ経路（runAvatarCore）で生成する。
 *
 * 実行方法:
 *   cd functions
 *   npm run build && GEMINI_API_KEY=xxx node lib/scripts/backfill-persona-avatars.js [--apply] [--topic <topicId>] [--persona <personaId>]
 *
 * --apply を付けない限り生成せず、対象一覧のみを表示する（dry-run 既定）。
 * トピック単位・ペルソナ単位で段階的に実行できる。失敗分は生成時刻が未設定のまま残るので、
 * 再実行するか管理画面から個別再生成で回収する。
 *
 * 外見表現（genderPresentation）が未設定のペルソナは生成対象にしない
 * （先に backfill-persona-gender.ts と管理画面での個別設定を済ませる）。
 *
 * 前提: Application Default Credentials と GEMINI_API_KEY が設定済みであること
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runAvatarCore } from '../api/avatars.js';

const argValue = (flag: string): string | undefined => {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : undefined;
};

const main = async (): Promise<void> => {
	const apply = process.argv.includes('--apply');
	const onlyTopic = argValue('--topic');
	const onlyPersona = argValue('--persona');
	if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
	if (!getApps().length) {
		initializeApp({ projectId: 'logotope14', storageBucket: 'logotope14.firebasestorage.app' });
	}
	const db = getFirestore();

	const topics = await db.collection('topics').get();
	let generated = 0;
	let skipped = 0;
	let failed = 0;
	for (const topic of topics.docs) {
		if (onlyTopic && topic.id !== onlyTopic) continue;
		const snap = await db.collection(`topics/${topic.id}/personas`).orderBy('sortOrder').get();
		for (const doc of snap.docs) {
			if (onlyPersona && doc.id !== onlyPersona) continue;
			const data = doc.data();
			if (!data.genderPresentation) {
				console.log(`  SKIP ${doc.id} (${data.name}) — genderPresentation 未設定`);
				skipped++;
				continue;
			}
			console.log(`  ${apply ? 'GEN ' : 'PLAN'} ${doc.id} (${data.name}) ${data.age}歳 ${data.occupation}`);
			if (!apply) continue;

			await runAvatarCore(topic.id, doc.id);
			// core は失敗を握って戻るため、生成時刻の有無で成否を判定する。
			const after = await db.doc(`topics/${topic.id}/personas/${doc.id}`).get();
			if (after.data()?.avatarGeneratedAt) generated++;
			else {
				console.log(`    FAILED ${doc.id} — 生成時刻が未設定のまま（個別再生成で回収する）`);
				failed++;
			}
		}
	}
	console.log(`\n生成=${generated} 失敗=${failed} 対象外=${skipped}`);
	console.log(apply ? 'applied' : 'dry-run (pass --apply to generate)');
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
