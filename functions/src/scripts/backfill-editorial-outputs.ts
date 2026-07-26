/**
 * Migration: 編集成果物ドキュメントの命名整理に伴い、既存の全トピックの editorial/0 の内容を
 * editorial/outputs へコピーする（editing-pass-regeneration-efficiency spec / Req 6.3-6.5）。
 *
 * 実行方法:
 *   cd functions
 *   npm run build && node lib/scripts/backfill-editorial-outputs.js [--apply]
 *
 * --apply を付けない限り書き込まず、計画のみを表示する（dry-run 既定）。
 * editorial/outputs が既にあるトピックはスキップするため、繰り返し実行しても内容を変えない（冪等）。
 * 旧 editorial/0 は削除しない（コードを戻せば復旧できるよう残す）。デプロイの前に実行する（backfill 先行）。
 *
 * 前提: Application Default Credentials が設定済みであること
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

type BackfillOutcome = 'copied' | 'skipped-exists' | 'skipped-no-source';

const db = () => getFirestore();

/**
 * 1トピックの editorial/0 を editorial/outputs へ移行する。
 * outputs が既に存在すればスキップ（冪等・上書きしない）、0 が無ければ無操作。
 * apply=false のときは書き込まず、コピー対象かどうかの判定だけ返す（dry-run）。
 */
export const backfillTopicOutputs = async (
	topicId: string,
	apply: boolean
): Promise<BackfillOutcome> => {
	const outputsRef = db().doc(`topics/${topicId}/editorial/outputs`);
	const outputsSnap = await outputsRef.get();
	if (outputsSnap.exists) return 'skipped-exists';

	const legacySnap = await db().doc(`topics/${topicId}/editorial/0`).get();
	if (!legacySnap.exists) return 'skipped-no-source';

	if (apply) await outputsRef.set(legacySnap.data() as Record<string, unknown>);
	return 'copied';
};

const main = async (): Promise<void> => {
	const apply = process.argv.includes('--apply');
	if (!getApps().length) initializeApp({ projectId: 'logotope14' });

	const topics = await db().collection('topics').get();
	const counts: Record<BackfillOutcome, number> = {
		copied: 0,
		'skipped-exists': 0,
		'skipped-no-source': 0
	};
	for (const topic of topics.docs) {
		const outcome = await backfillTopicOutputs(topic.id, apply);
		counts[outcome]++;
		if (outcome === 'copied') console.log(`  ${topic.id}: editorial/0 -> editorial/outputs`);
	}
	console.log(
		`copied=${counts.copied} skipped(exists)=${counts['skipped-exists']} skipped(no-source)=${counts['skipped-no-source']}`
	);
	console.log(apply ? 'applied' : 'dry-run (pass --apply to write)');
};

// スクリプトとして直接実行されたときのみ main を走らせる（テストからの import では走らせない）。
if (process.argv[1]?.includes('backfill-editorial-outputs')) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
