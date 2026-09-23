/**
 * Migration: 既存ペルソナの所在フィールドを現行スキーマへ改名する。
 *
 *   homePrefecture → prefecture（47都道府県の有限集合）
 *   nationality    → country（自由記述）
 *
 * 値の解釈を伴わない改名である。空文字だった項目は任意項目として未設定にし、空文字で不在を
 * 表す運用をここで終える。nationality は国の値そのものなので country へそのまま移す
 * （国外ペルソナの所在を捨てない）。旧フィールドは削除する。
 *
 * 実行方法:
 *   cd functions
 *   npx tsx src/scripts/backfill-persona-location.ts [--apply]
 *
 * --apply を付けない限り書き込まず、計画のみを表示する（dry-run 既定）。
 * 旧フィールドを持たないペルソナは対象外なので、中断後に再実行しても結果は同じになる。
 *
 * 都道府県の正式表記として読めない値は推測で埋めず、手動判断が要るものとして列挙する。
 *
 * 前提: Application Default Credentials が設定済みであること
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { PREFECTURES } from '../constants/surname-regions.js';

/** 旧フィールドを持つ永続形。現行の PersonaForFirestore はこれらを持たないため移行専用に置く。 */
export type LegacyPersonaLocation = {
	ref: string;
	name: string;
	homePrefecture?: string;
	nationality?: string;
};

export type LocationPlan = {
	ref: string;
	name: string;
	/** 移行前の値。計画表示で「何がどう変わるか」をそのまま読めるようにする */
	before: { homePrefecture: string | undefined; nationality: string | undefined };
	prefecture: string | null;
	country: string | null;
	/** 都道府県の正式表記として読めない非空の値。推測で埋めず手動判断に回す */
	unreadablePrefecture: string | null;
};

/** Firestore の1回の batch に入れられる書き込み数の上限 */
const BATCH_LIMIT = 500;

/**
 * 旧フィールドから新フィールドの値を決める。空文字は未設定（null）へ畳む。
 * 旧フィールドをどちらも持たないペルソナは対象外（移行済み）として落とす。
 */
export const planLocationBackfill = (personas: LegacyPersonaLocation[]): LocationPlan[] =>
	personas
		.filter((persona) => persona.homePrefecture !== undefined || persona.nationality !== undefined)
		.map((persona) => {
			const homePrefecture = (persona.homePrefecture ?? '').trim();
			const nationality = (persona.nationality ?? '').trim();
			const readable =
				homePrefecture !== '' && (PREFECTURES as readonly string[]).includes(homePrefecture);
			return {
				ref: persona.ref,
				name: persona.name,
				before: { homePrefecture: persona.homePrefecture, nationality: persona.nationality },
				prefecture: readable ? homePrefecture : null,
				country: nationality === '' ? null : nationality,
				unreadablePrefecture: homePrefecture !== '' && !readable ? homePrefecture : null
			};
		});

const main = async (): Promise<void> => {
	const apply = process.argv.includes('--apply');

	if (!getApps().length) initializeApp({ projectId: 'logotope14' });
	const db = getFirestore();

	const snap = await db.collectionGroup('personas').get();
	const pathByRef = new Map<string, string>();
	const personas: LegacyPersonaLocation[] = snap.docs.map((doc) => {
		const data = doc.data() as { name?: string; homePrefecture?: string; nationality?: string };
		const ref = `${doc.ref.parent.parent!.id}/${doc.id}`;
		pathByRef.set(ref, doc.ref.path);
		return {
			ref,
			name: data.name ?? '(名前なし)',
			...('homePrefecture' in data ? { homePrefecture: data.homePrefecture ?? '' } : {}),
			...('nationality' in data ? { nationality: data.nationality ?? '' } : {})
		};
	});

	const plans = planLocationBackfill(personas);
	const unreadable = plans.filter((plan) => plan.unreadablePrefecture !== null);

	console.log(`ペルソナ ${snap.size}体 / 移行対象 ${plans.length}体`);
	console.log(
		'各ドキュメントで書き換えるのは所在の4項目だけ（homePrefecture/nationality を削除し prefecture/country を書く）。\n'
	);
	const show = (value: string | null | undefined) =>
		value === undefined ? '(項目なし)' : value === null || value === '' ? '(未設定)' : value;
	for (const plan of plans) {
		console.log(`  ${plan.name}`);
		console.log(
			`    homePrefecture ${show(plan.before.homePrefecture)} → prefecture ${show(plan.prefecture)}`
		);
		console.log(
			`    nationality    ${show(plan.before.nationality)} → country    ${show(plan.country)}`
		);
	}

	console.log(
		`\n--- 都道府県の正式表記として読めない値: ${unreadable.length}件（推測で埋めず手動で決める）---`
	);
	for (const plan of unreadable) {
		console.log(`  ${plan.ref}\t${plan.name}\t「${plan.unreadablePrefecture}」`);
	}

	if (!apply) {
		console.log('\n(dry-run: 書き込みなし。--apply で反映)');
		return;
	}
	if (unreadable.length > 0) {
		throw new Error(
			'都道府県として読めない値が残っています。該当ペルソナの扱いを決めてから --apply してください'
		);
	}

	for (let offset = 0; offset < plans.length; offset += BATCH_LIMIT) {
		const batch = db.batch();
		for (const plan of plans.slice(offset, offset + BATCH_LIMIT)) {
			batch.update(db.doc(pathByRef.get(plan.ref)!), {
				...(plan.prefecture === null ? {} : { prefecture: plan.prefecture }),
				...(plan.country === null ? {} : { country: plan.country }),
				homePrefecture: FieldValue.delete(),
				nationality: FieldValue.delete()
			});
		}
		await batch.commit();
	}
	console.log(`\n${plans.length}体を更新しました`);
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
