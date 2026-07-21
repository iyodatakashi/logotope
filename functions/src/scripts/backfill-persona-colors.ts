/**
 * Migration: 既存の全トピックのペルソナへ配色（colorKey）を付与する。
 *
 * 実行方法:
 *   cd functions
 *   npm run build && node lib/scripts/backfill-persona-colors.js [--apply]
 *
 * --apply を付けない限り書き込まず、計画のみを表示する（dry-run 既定）。
 * 配色が未設定のペルソナにのみ付与するため、繰り返し実行しても既存の割り当てを変えない。
 *
 * 前提: Application Default Credentials が設定済みであること
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { assignAll } from '../pipeline/personas/avatar-color.js';

type PersonaForBackfill = { id: string; sortOrder: number; colorKey?: string };

/**
 * トピックのペルソナ集合から、書き込むべき配色だけを決める。
 * 割り当ては安定順序（sortOrder）と人数だけで決まり、既に配色を持つペルソナは対象にしない。
 */
export const planColorBackfill = (
	personas: PersonaForBackfill[]
): { id: string; colorKey: string }[] => {
	const ordered = [...personas].sort((a, b) => a.sortOrder - b.sortOrder);
	const colorKeys = assignAll(ordered.length);
	return ordered.flatMap((persona, index) =>
		persona.colorKey ? [] : [{ id: persona.id, colorKey: colorKeys[index] }]
	);
};

const main = async (): Promise<void> => {
	const apply = process.argv.includes('--apply');
	if (!getApps().length) initializeApp({ projectId: 'logotope14' });
	const db = getFirestore();

	const topics = await db.collection('topics').get();
	for (const topic of topics.docs) {
		const snap = await db.collection(`topics/${topic.id}/personas`).get();
		const personas = snap.docs.map((doc) => ({
			id: doc.id,
			sortOrder: (doc.data().sortOrder as number) ?? 0,
			colorKey: doc.data().colorKey as string | undefined
		}));
		const plan = planColorBackfill(personas);
		console.log(`${topic.id}: ${personas.length} personas, ${plan.length} to assign`);
		for (const entry of plan) {
			console.log(`  ${entry.id} -> ${entry.colorKey}`);
			if (apply) {
				await db.doc(`topics/${topic.id}/personas/${entry.id}`).update({
					colorKey: entry.colorKey
				});
			}
		}
	}
	console.log(apply ? 'applied' : 'dry-run (pass --apply to write)');
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
