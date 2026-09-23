/**
 * 【実行済みの記録。現行スキーマでは動作しない】
 * homePrefecture を持っていた時代の移行スクリプト。所在は country? / prefecture? の任意2項目へ
 * 改名済みで（topic-intent-fidelity）、この処理の対象データはもう存在しない。討論本文まで含めて
 * 姓を差し替える手順を残すために保存しており、再実行はしない。
 *
 * Migration: 既存ペルソナの姓を、居住地に応じた新しい割り当てに揃える。
 *
 * 姓の決定を LLM から取り上げる前に生成されたペルソナは、モデルの偏った語彙から姓が付いている
 * （郡司が8トピック中6件など）。それを現在の割り当て（constants/japanese-surnames.ts）へ揃える。
 *
 * 難所は討論本文との整合。討論では「○○さん」と名前で呼びかけ、章要約や記事では「郡司は〜」と
 * 姓だけで指すため、ペルソナ文書だけ差し替えると本文が存在しない人物を呼び続けることになる。
 * そこで本文中の出現も併せて書き換える。
 *
 * 置換してよいかは2つの手がかりで決まる。実データを見ると、衝突するのは普通名詞ではなく
 * 「ファクトチェックが引いてきた同姓の実在人物」だった（例: 経済評論家の三橋貴明氏）。
 *
 * 判別は置き場所で行う。turns[].factCheck 配下は外部を調べた結果の記録で、そこにだけ同姓の
 * 実在人物が現れる。それ以外（発言・章要約・記事・所感）は登場人物についての記述しかない。
 *
 *   factCheck 配下 … 「姓 名」「姓さん」という疑いようのない形だけ置換し、残りは保留する
 *   それ以外       … 姓の出現をすべて置換する
 *
 * 後続の文字で判断する案は採らない。敬称や肩書きが姓に直接続く形（大河内議員・郡司部長）が
 * 日本語では普通で、肩書きを列挙しきれないため本人への言及を取りこぼす（実際に17件落ちた）。
 * ただし姓に漢字・カタカナが続く箇所は同姓の別人であり得るので、置換する場合も一覧に出す
 * （--show-ambiguous）。適用前にそこだけ読めばよい。
 *
 * 名は変えない。討論の呼びかけは姓が主だが、名を変えると本文との不一致が増えるだけで得が無い。
 *
 * 実行方法:
 *   cd functions
 *   npx tsx src/scripts/backfill-persona-surnames.ts [--topic <topicId>] [--apply] [--show-bare]
 *
 * --show-bare は「姓単独」の出現箇所を前後の文とともに出す。この形が本当に人物を指しているのか、
 * 普通名詞との偶然の一致なのかは件数では判らないため、置換してよいかを目で確かめるために使う。
 *
 * --apply を付けない限り書き込まず、計画と波及範囲のみを表示する（dry-run 既定）。
 * 抽選は topicId から導いた種で回すので、dry-run に出る名前がそのまま書き込まれる
 * （毎回引き直すと、確認した名前と違うものが入ってしまう）。
 *
 * --mark-migrated は改名せず、移行済みの印だけを付ける。種を導入する前に移行したトピックへ
 * 後から印を付けるための口（印が無いと二度目の適用で別の姓へ引き直してしまう）。
 * --apply は --topic 必須。どのトピックを移行するかは人が選ぶ（新しい命名で生成済みのトピックを
 * 巻き込んで改名すると、せっかく付いた地域の姓を壊すため、全件一括の適用口は用意しない）。
 *
 * 前提: Application Default Credentials が設定済みであること
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { CollectionReference, DocumentSnapshot } from 'firebase-admin/firestore';
import { assignSurnames } from '../pipeline/personas/surname-assignment.js';
import type { PersonaForFirestore } from '../types/persona.types.js';

type Rename = {
	topicId: string;
	personaId: string;
	oldName: string;
	oldSurname: string;
	givenName: string;
	newSurname: string;
	newName: string;
};

/** 移行済みの印。二度当てると別の姓へ引き直してしまうため、済んだトピックは弾く */
const MIGRATED_FIELD = 'personaSurnamesMigratedAt';

/**
 * topicId から決まる擬似乱数。dry-run と --apply で同じ姓を引かせるために使う。
 * 確認した名前と違うものが書き込まれると、確認そのものが意味を失う。
 */
const seededRandom = (seed: string): (() => number) => {
	let state = 0;
	for (const character of seed) state = (state * 31 + character.charCodeAt(0)) >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

/** 本文中での名前の現れ方。置換できる形と、別人かもしれない形を分けて数える */
type Occurrences = { replaceable: number; ambiguous: number };

/** 姓の直後がこれなら、別の名前が続いている可能性がある（漢字・カタカナ） */
const NAME_CONTINUATION = /[\p{Script=Han}\p{Script=Katakana}ヶヵ々]/u;

/** 外部を調べた結果が入る部分木。ここには同姓の実在人物が現れる */
const EXTERNAL_RESEARCH_KEY = 'factCheck';

const main = async (): Promise<void> => {
	const apply = process.argv.includes('--apply');
	const markOnly = process.argv.includes('--mark-migrated');
	const only = readArg('--topic');
	if ((apply || markOnly) && !only)
		throw new Error('--apply / --mark-migrated には --topic が必要です');

	if (markOnly) {
		if (!getApps().length) initializeApp({ projectId: 'logotope14' });
		await getFirestore()
			.doc(`topics/${only}`)
			.update({ [MIGRATED_FIELD]: Timestamp.now() });
		console.log(`${only} に移行済みの印を付けました`);
		return;
	}

	if (!getApps().length) initializeApp({ projectId: 'logotope14' });
	const db = getFirestore();

	const topicIds = only ? [only] : (await db.collection('topics').get()).docs.map((doc) => doc.id);

	for (const topicId of topicIds) {
		const topicSnap = await db.doc(`topics/${topicId}`).get();
		if (topicSnap.get(MIGRATED_FIELD)) {
			if (only)
				console.log(`${topicId} は移行済み（${MIGRATED_FIELD}）。二重適用を避けるため何もしません`);
			continue;
		}
		const personaSnap = await db
			.collection(`topics/${topicId}/personas`)
			.orderBy('sortOrder')
			.get();
		if (personaSnap.empty) continue;
		const personas = personaSnap.docs.map((doc) => ({
			...(doc.data() as PersonaForFirestore),
			id: doc.id
		}));

		const renames = planRenames(topicId, personas);
		if (renames.length === 0) continue;

		// トピック配下の全文書を舐めて、名前の出現を数える（文書構造に依存しない）
		const documents = await readAllDocuments(db.collection('topics').doc(topicId));
		console.log(`\n=== ${topicId}（文書 ${documents.length}件）===`);

		const showAmbiguous = process.argv.includes('--show-ambiguous');
		let held = 0;
		for (const rename of renames) {
			const found = countOccurrences(documents, rename);
			console.log(
				`  ${rename.oldName} → ${rename.newName}\t本文 置換${found.replaceable}` +
					(found.ambiguous > 0 ? ` / 要確認${found.ambiguous}` : '')
			);
			if (found.ambiguous > 0) {
				held += found.ambiguous;
				if (showAmbiguous) printAmbiguous(documents, rename);
			}
		}
		if (held > 0) {
			console.log(
				`  ※ 姓に別の名前が続く箇所が ${held}件ある（調査記録の中なら置換せず保留、それ以外は置換する）。` +
					'--show-ambiguous で文脈を出せる'
			);
		}

		if (!apply) continue;
		await applyRenames(db, topicId, renames, documents);
		console.log(`  ${renames.length}人を改名し、本文を書き換えました`);
	}

	if (!apply) console.log('\n(dry-run: 書き込みなし。--apply で反映)');
};

/** 居住地に応じた新しい姓を、キャスト全体で重複しないように決める（本番と同じ assignSurnames を使う） */
const planRenames = (
	topicId: string,
	personas: Array<PersonaForFirestore & { id: string }>
): Rename[] => {
	// 日本人ペルソナだけが対象。外国人ペルソナ（中黒表記）は姓を割り当てない
	const targets = personas.map((persona) =>
		!persona.name.includes('・') && persona.name.includes(' ') ? (persona.prefecture ?? null) : null
	);
	const surnames = assignSurnames(targets, seededRandom(topicId));

	return personas.flatMap((persona, index) => {
		if (targets[index] === null) return [];
		const [oldSurname, ...rest] = persona.name.split(/[\s\u3000]+/);
		const givenName = rest.join(' ');
		const newSurname = surnames[index];
		if (!newSurname || newSurname === oldSurname) return [];
		return [
			{
				topicId,
				personaId: persona.id,
				oldName: persona.name,
				oldSurname,
				givenName,
				newSurname,
				newName: `${newSurname} ${givenName}`
			}
		];
	});
};

/** トピック配下の全サブコレクションの全文書を集める */
const readAllDocuments = async (
	topic: FirebaseFirestore.DocumentReference
): Promise<DocumentSnapshot[]> => {
	const collections: CollectionReference[] = await topic.listCollections();
	const documents: DocumentSnapshot[] = [];
	for (const collection of collections) {
		const snap = await collection.get();
		documents.push(...snap.docs);
	}
	return documents;
};

/**
 * 1つの文字列に対する改名の適用結果と、判断を保留した箇所を返す。
 * 判定は上のルール（姓の直後が漢字・カタカナなら別人の可能性）に従う。
 */
const rewriteOne = (
	text: string,
	rename: Rename,
	external = false
): { text: string; replaced: number; ambiguous: string[] } => {
	// 疑いようのない形を先に潰す。残った姓だけを後続文字で判定する
	let result = text
		.split(rename.oldName)
		.join(rename.newName)
		.split(`${rename.oldSurname}${rename.givenName}`)
		.join(`${rename.newSurname}${rename.givenName}`)
		.split(`${rename.oldSurname}さん`)
		.join(`${rename.newSurname}さん`);
	let replaced = countMatches(text, result, rename);

	// 外部調査の記録では、これ以上は踏み込まない（同姓の実在人物と区別できないため）
	if (external) {
		const ambiguous: string[] = [];
		let at = result.indexOf(rename.oldSurname);
		while (at >= 0) {
			ambiguous.push(
				`…${result.slice(Math.max(0, at - 12), at)}【${rename.oldSurname}】` +
					`${result.slice(at + rename.oldSurname.length, at + rename.oldSurname.length + 12)}…`
			);
			at = result.indexOf(rename.oldSurname, at + rename.oldSurname.length);
		}
		return { text: result, replaced, ambiguous };
	}

	// 外部調査の記録ではない。姓の出現はすべて本人を指すものとして置換する。
	// ただし姓に別の名前が続き得る箇所は、目で確かめられるよう一覧へ残す。
	const ambiguous: string[] = [];
	let out = '';
	let from = 0;
	for (;;) {
		const at = result.indexOf(rename.oldSurname, from);
		if (at < 0) break;
		const after = result.slice(at + rename.oldSurname.length);
		if (NAME_CONTINUATION.test(after.slice(0, 1))) {
			ambiguous.push(
				`…${result.slice(Math.max(0, at - 12), at)}【${rename.oldSurname}】${after.slice(0, 12)}…`
			);
		}
		out += result.slice(from, at) + rename.newSurname;
		replaced += 1;
		from = at + rename.oldSurname.length;
	}
	out += result.slice(from);
	result = out;

	return { text: result, replaced, ambiguous };
};

/** 確実な形の置換で何箇所変わったかを数える（新旧の姓の出現差から求める） */
const countMatches = (before: string, after: string, rename: Rename): number =>
	count(after, rename.newSurname) - count(before, rename.newSurname);

const countOccurrences = (documents: DocumentSnapshot[], rename: Rename): Occurrences => {
	const found: Occurrences = { replaceable: 0, ambiguous: 0 };
	for (const document of documents) {
		for (const { text, external } of collectStrings(document.data())) {
			const result = rewriteOne(text, rename, external);
			found.replaceable += result.replaced;
			found.ambiguous += result.ambiguous.length;
		}
	}
	return found;
};

/**
 * 置換を保留した箇所（姓に別の名前が続いているもの）を、どの文書のどの文脈かとともに出す。
 * ここが同姓の実在人物なのか本人の別表記なのかは、読まないと決められない。
 */
const printAmbiguous = (documents: DocumentSnapshot[], rename: Rename): void => {
	const contexts: string[] = [];
	for (const document of documents) {
		const where = `${document.ref.parent.id}/${document.id}`;
		for (const { text, external } of collectStrings(document.data())) {
			for (const context of rewriteOne(text, rename, external).ambiguous) {
				contexts.push(`${where.padEnd(28)}${external ? ' [調査記録]' : '          '} ${context}`);
			}
		}
	}
	if (contexts.length === 0) return;
	console.log(`  [要確認] ${rename.oldName}（${contexts.length}件。[調査記録] は置換せず保留）`);
	for (const context of contexts.slice(0, 20)) console.log(`      ${context}`);
};

/**
 * 文書内の全文字列を、外部調査の部分木にあるかどうかの印つきで集める。
 * 構造に依存せず本文を舐めつつ、置き場所による扱いの違いだけを拾う。
 */
type Located = { text: string; external: boolean };

const collectStrings = (value: unknown, external = false): Located[] => {
	if (typeof value === 'string') return [{ text: value, external }];
	if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, external));
	if (value !== null && typeof value === 'object' && value.constructor === Object) {
		return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
			collectStrings(item, external || key === EXTERNAL_RESEARCH_KEY)
		);
	}
	return [];
};

const count = (haystack: string, needle: string): number =>
	needle ? haystack.split(needle).length - 1 : 0;

/**
 * 改名を反映する。ペルソナ文書の name を差し替え、本文中の「フルネーム」「姓さん」を書き換える。
 * 姓単独の出現は普通名詞と重なりうるため触らない（dry-run で件数を出して人が判断する）。
 *
 * 書き換えは文字列フィールドだけを対象に再帰的に行う。文書全体を JSON で往復させると
 * Timestamp が単なる map になって壊れるため、文字列以外の値には一切触れない。
 */
const applyRenames = async (
	db: FirebaseFirestore.Firestore,
	topicId: string,
	renames: Rename[],
	documents: DocumentSnapshot[]
): Promise<void> => {
	const batch = db.batch();

	const rewriteText = (text: string, external: boolean): string =>
		renames.reduce((result, rename) => rewriteOne(result, rename, external).text, text);

	let changed = 0;
	const rewrite = (value: unknown, external: boolean): unknown => {
		if (typeof value === 'string') {
			const next = rewriteText(value, external);
			if (next !== value) changed += 1;
			return next;
		}
		if (Array.isArray(value)) return value.map((item) => rewrite(item, external));
		// Timestamp・GeoPoint 等のクラスインスタンスは触らない（プレーンな map だけ再帰する）
		if (value !== null && typeof value === 'object' && value.constructor === Object) {
			return Object.fromEntries(
				Object.entries(value as Record<string, unknown>).map(([key, item]) => [
					key,
					rewrite(item, external || key === EXTERNAL_RESEARCH_KEY)
				])
			);
		}
		return value;
	};

	for (const document of documents) {
		const before = changed;
		const data = rewrite(document.data(), false) as Record<string, unknown>;
		if (changed === before) continue;
		batch.set(document.ref, data);
	}

	// ペルソナ名の確定は文書の書き換えより後に積む。バッチは積んだ順に適用されるため、
	// 先に積むと同じペルソナ文書への set に上書きされて旧名へ戻る。
	for (const rename of renames) {
		batch.update(db.doc(`topics/${topicId}/personas/${rename.personaId}`), {
			name: rename.newName
		});
	}

	batch.update(db.doc(`topics/${topicId}`), { [MIGRATED_FIELD]: Timestamp.now() });

	await batch.commit();
};

const readArg = (flag: string): string | undefined => {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : undefined;
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
