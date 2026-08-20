/**
 * 気づき（awareness）の産出量と質を点検する。
 *
 * 気づきは討論・所感の主軸だが、出力の妥当性は機械判定できない。ここでは「人が読んで決める」ための
 * 材料を揃える: 産出量・ペルソナ別の偏り・プロンプトの自己点検に反する疑いのある件・全文サンプル。
 *
 * 見る観点（プロンプトが定めた基準）:
 *   awareness は「直前発言によって結論・立場そのものが以前と別の場所に動いたとき」だけ出す。
 *   自己点検: content が「改めて」「やはり」「再確認」「深く理解した／腹落ちした」で自然に書けるなら、
 *   結論は動いておらず再認識なので null にすべき。→ これらの語を含む件は基準違反の疑いとして数える。
 *
 * 実行:
 *   cd functions
 *   npx tsx src/scripts/inspect-awareness.ts <topicId> [--samples 20]
 *
 * 前提: Application Default Credentials が設定済みであること
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { AwarenessForFirestore, PersonaForFirestore } from '../types/persona.types.js';

/** プロンプトが「これで自然に書けるなら null」と指定した言い回し。含む件は再認識の疑い。 */
const RESTATEMENT_MARKERS = [
	'改めて',
	'やはり',
	'再確認',
	'深く理解',
	'腹落ち',
	'再認識',
	'あらためて',
	'認識を新た'
];

type AwarenessRow = AwarenessForFirestore & { personaName: string };

const main = async (): Promise<void> => {
	const topicId = process.argv[2];
	if (!topicId || topicId.startsWith('--')) throw new Error('topicId を指定してください');
	const sampleCount = Number(readArg('--samples') ?? 20);

	if (!getApps().length) initializeApp({ projectId: 'logotope14' });
	const db = getFirestore();

	const [personaSnap, chapterSnap] = await Promise.all([
		db.collection(`topics/${topicId}/personas`).orderBy('sortOrder').get(),
		db.collection(`topics/${topicId}/chapters`).orderBy('chapterIndex').get()
	]);

	const turns = chapterSnap.docs.flatMap(
		(chapter) => (chapter.data().turns ?? []) as Array<{ id: string; personaId?: string }>
	);
	const turnOrder = new Map(turns.map((turn, index) => [turn.id, index]));

	const personas = personaSnap.docs
		.map((doc) => ({ ...(doc.data() as PersonaForFirestore), id: doc.id }))
		.filter((persona) => persona.selected);

	const rows: AwarenessRow[] = personas.flatMap((persona) =>
		(persona.awarenesses ?? []).map((awareness) => ({ ...awareness, personaName: persona.name }))
	);

	const evaluationPoints = turns.length * (personas.length - 1);
	console.log(
		`トピック ${topicId}: ペルソナ${personas.length} / ターン${turns.length} / 評価地点${evaluationPoints}`
	);
	console.log(
		`気づき ${rows.length}件（検出率 ${((rows.length / evaluationPoints) * 100).toFixed(1)}%）` +
			` 受容${rows.filter((row) => row.kind === 'reception').length}` +
			` / 自発${rows.filter((row) => row.kind === 'self').length}`
	);

	printPersonaBalance(personas, rows, turns);
	printSuspectedRestatements(rows);
	printTurnDistribution(rows, turnOrder, turns.length);
	printSamples(rows, sampleCount);
};

/** ペルソナ別の偏り。発言数も併記して「話し過ぎて評価対象から外れている」等の説明がつくか見る */
const printPersonaBalance = (
	personas: Array<{ id: string; name: string; awarenesses?: AwarenessForFirestore[] }>,
	rows: AwarenessRow[],
	turns: Array<{ personaId?: string }>
): void => {
	console.log('\n=== ペルソナ別 ===');
	const sorted = [...personas].sort(
		(a, b) => (b.awarenesses?.length ?? 0) - (a.awarenesses?.length ?? 0)
	);
	for (const persona of sorted) {
		const own = rows.filter((row) => row.personaName === persona.name);
		const spoke = turns.filter((turn) => turn.personaId === persona.id).length;
		console.log(
			`  ${persona.name.padEnd(8)} 気づき${String(own.length).padStart(3)}件` +
				`（受容${own.filter((row) => row.kind === 'reception').length}` +
				`/自発${own.filter((row) => row.kind === 'self').length}）` +
				`  発言${String(spoke).padStart(3)}回`
		);
	}
};

/** プロンプトが null にせよと指定した「再認識」の言い回しを含む件を数える */
const printSuspectedRestatements = (rows: AwarenessRow[]): void => {
	const suspects = rows.filter((row) =>
		RESTATEMENT_MARKERS.some((marker) => row.content.includes(marker))
	);
	console.log('\n=== 自己点検に反する疑い（再認識の言い回しを含む）===');
	console.log(
		`  ${suspects.length}/${rows.length}件（${((suspects.length / rows.length) * 100).toFixed(1)}%）`
	);
	for (const marker of RESTATEMENT_MARKERS) {
		const hits = rows.filter((row) => row.content.includes(marker)).length;
		if (hits > 0) console.log(`    「${marker}」 ${hits}件`);
	}
	for (const suspect of suspects.slice(0, 5)) {
		console.log(`    - ${suspect.personaName}: ${suspect.content}`);
	}
};

/** 討論のどのあたりで気づきが出ているか（後半に偏るなら蓄積の影響を疑う） */
const printTurnDistribution = (
	rows: AwarenessRow[],
	turnOrder: Map<string, number>,
	turnCount: number
): void => {
	console.log('\n=== 討論の進行と気づき（4分割）===');
	const buckets = [0, 0, 0, 0];
	let unknown = 0;
	for (const row of rows) {
		const order = turnOrder.get(row.triggeredByTurnId);
		if (order === undefined) {
			unknown += 1;
			continue;
		}
		buckets[Math.min(3, Math.floor((order / turnCount) * 4))] += 1;
	}
	buckets.forEach((count, index) =>
		console.log(`  ${index * 25}〜${(index + 1) * 25}%: ${String(count).padStart(3)}件`)
	);
	if (unknown > 0) console.log(`  由来ターン不明（破棄済みターン由来）: ${unknown}件`);
};

/** 中身は人が読んで決める。等間隔で抜いて全文を出す */
const printSamples = (rows: AwarenessRow[], sampleCount: number): void => {
	console.log(`\n=== 全文サンプル（${Math.min(sampleCount, rows.length)}件）===`);
	const stride = Math.max(1, rows.length / sampleCount);
	for (let i = 0; i < rows.length; i += stride) {
		const row = rows[Math.floor(i)];
		console.log(
			`  [${row.kind === 'reception' ? '受容' : '自発'}] ${row.personaName}: ${row.content}`
		);
	}
};

const readArg = (name: string): string | undefined => {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
