/**
 * Migration: 既存の全トピックのペルソナへ具体的立場 role を付与する（specificRole → role の改名移行）。
 *
 * 実行方法:
 *   cd functions
 *   npm run build && node lib/scripts/backfill-persona-role.js [--apply]
 *
 * --apply を付けない限り書き込まず、計画のみを表示する（dry-run 既定）。
 * 冪等: 既に非空の role を持つペルソナは対象にしないため、繰り返し実行しても二重変換しない。
 * 値は specificRole（非空）を優先し、欠落・空のときだけ一度だけ総称 stakeholderRole を焼き込む
 * （非空不変条件を満たすための移行専用の穴埋めであり、恒常的なフォールバックではない）。
 * 旧 specificRole は削除しない（コードを戻せば復旧可能・ロールバック安全）。
 *
 * 前提: Application Default Credentials が設定済みであること
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

type PersonaForBackfill = {
	id: string;
	role?: string;
	specificRole?: string;
	stakeholderRole?: string;
};

const nonEmpty = (value?: string): boolean => value != null && value.trim() !== '';

/**
 * トピックのペルソナ集合から、書き込むべき role だけを決める。
 * 既に非空の role を持つペルソナは対象にしない（冪等）。role の値は specificRole（非空）優先、
 * 欠落・空なら stakeholderRole。どちらも空なら書き込まない（空の role を作らない）。
 */
export const planRoleBackfill = (
	personas: PersonaForBackfill[]
): { id: string; role: string }[] =>
	personas.flatMap((persona) => {
		if (nonEmpty(persona.role)) return [];
		const role = nonEmpty(persona.specificRole)
			? (persona.specificRole as string)
			: (persona.stakeholderRole ?? '');
		return nonEmpty(role) ? [{ id: persona.id, role }] : [];
	});

const main = async (): Promise<void> => {
	const apply = process.argv.includes('--apply');
	if (!getApps().length) initializeApp({ projectId: 'logotope14' });
	const db = getFirestore();

	const topics = await db.collection('topics').get();
	for (const topic of topics.docs) {
		const snap = await db.collection(`topics/${topic.id}/personas`).get();
		const personas = snap.docs.map((doc) => ({
			id: doc.id,
			role: doc.data().role as string | undefined,
			specificRole: doc.data().specificRole as string | undefined,
			stakeholderRole: doc.data().stakeholderRole as string | undefined
		}));
		const plan = planRoleBackfill(personas);
		console.log(`${topic.id}: ${personas.length} personas, ${plan.length} to migrate`);
		for (const entry of plan) {
			console.log(`  ${entry.id} -> role: ${entry.role}`);
			if (apply) {
				// role のみを書く（specificRole は削除しない・ロールバック安全）。
				await db.doc(`topics/${topic.id}/personas/${entry.id}`).update({ role: entry.role });
			}
		}
	}
	console.log(apply ? 'applied' : 'dry-run (pass --apply to write)');
};

// スクリプトとして直接実行されたときだけ main を走らせる（テストからの import では走らせない）。
if (process.argv[1]?.endsWith('backfill-persona-role.js')) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
