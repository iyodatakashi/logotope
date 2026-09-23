/**
 * 生成された人名の偏りを点検する。
 *
 * ペルソナ名は「実在の一人」らしさを支える要素だが、LLM は姓名の分布が本来の頻度より
 * 極端に狭くなる（少数の姓に集中する）。プロンプトの命名ルールが効いているかを、
 * 実際に生成された全ペルソナの姓・名の頻度で確かめる。
 *
 * 見る観点:
 *   - 姓の集中度: 上位姓が全体の何割を占めるか（日本の実人口比と比べて過剰か）
 *   - トピックをまたぐ再出現: 同じ姓が別トピックで何度も出ていないか
 *   - 同一トピック内の重複: 1回の生成の中で姓が衝突していないか
 *   - 禁止姓（プロンプトで明示的に避けさせている姓）が残っていないか
 *   - 地域性: 都道府県（prefecture）が地域色の強い県の人物に、その地域の姓が付いているか
 *   - 出自の別: 日本語の姓名と、それ以外の表記（中黒区切り）がどの割合で出ているか・国の内訳
 *   - 姓の後付け可否: 背景文が自分の姓に言及していないか（していなければコード側で姓を差し替えられる）
 *
 * 実行:
 *   cd functions
 *   npx tsx src/scripts/inspect-persona-names.ts [--top 30] [--topic <topicId>]
 *
 * 前提: Application Default Credentials が設定済みであること
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { REGIONAL_SURNAMES } from '../constants/japanese-surnames.js';
import { SURNAME_REGION_OF_PREFECTURE } from '../constants/surname-regions.js';
import type { PersonaForFirestore } from '../types/persona.types.js';

/** persona-generator-agent.ts の命名ルールが名指しで避けさせている姓・名。 */
const BANNED_SURNAMES = ['佐藤', '田中', '鈴木'];
const BANNED_GIVEN_NAMES = ['陽菜', '蓮', '葵'];

/**
 * 実在の日本人姓の上位10。実人口ではこの10姓だけで約1割を占める。
 *
 * 注意: 現在の割り当ては抽選の重みを人口の平方根に均しているため、これらが出る割合は実人口比より
 * 意図的に低い（1.5%程度→0.2%程度）。繰り返しを避けるために払っているコストなので、
 * 少ないこと自体は異常ではない。この指標が意味を持つのは「完全にゼロが続く」場合で、
 * それは分布の頭が丸ごと欠けている（＝禁止リスト時代の失敗の再来）を示す。
 */
const MOST_COMMON_REAL_SURNAMES = [
	'佐藤',
	'鈴木',
	'高橋',
	'田中',
	'伊藤',
	'渡辺',
	'山本',
	'中村',
	'小林',
	'加藤'
];

/**
 * 地域姓の判定には、割り当て側が使う表（constants/japanese-surnames.ts）をそのまま使う。
 * 独立した判定リストを手で持つ案は採らない。手書きでは表の規模（沖縄145姓）に遠く及ばず、
 * 実際に沖縄の姓が付いていても「地域の姓ではない」と誤報するため（1/7 と出た実例がある）。
 *
 * 循環にはならない。表の中身は外部データ（全国の町字名と実在姓のコーパス）から機械的に導いたもので、
 * ここで見たいのは「居住地に応じた割り当てが実際に効いているか」という経路の確認だから。
 * 表そのものの正しさは build-surname-tables.ts の出典と、割り当てのテストが受け持つ。
 */
const REGIONAL_POOL: Record<string, ReadonlySet<string>> = Object.fromEntries(
	Object.entries(SURNAME_REGION_OF_PREFECTURE).map(([prefecture, region]) => [
		prefecture,
		new Set(REGIONAL_SURNAMES[region].map(([surname]) => surname))
	])
);

type NameRow = {
	topicId: string;
	name: string;
	surname: string;
	givenName: string;
	/** 都道府県。持たない人物もいる */
	prefecture: string | null;
	/** 姓の地域区分を持つ県のときだけ都道府県名。地域色の弱い県・未設定は null */
	region: string | null;
	/** 背景・関心事が自分の姓を含むか */
	selfReferencesSurname: boolean;
	/** 日本語の姓名か（中黒区切りの表記でないか）。所在ではなく表記で判定する */
	isJapaneseName: boolean;
	/** その人物の国。持たない人物もいる */
	country: string | null;
};

const main = async (): Promise<void> => {
	const topN = Number(readArg('--top') ?? 30);

	if (!getApps().length) initializeApp({ projectId: 'logotope14' });
	const db = getFirestore();

	// --topic を付けると1トピックだけを見る（生成し直した直後の確認用）。既定は全トピック。
	const topicId = readArg('--topic');
	const snap = topicId
		? await db.collection(`topics/${topicId}/personas`).orderBy('sortOrder').get()
		: await db.collectionGroup('personas').get();
	const personas = snap.docs
		.map((doc) => doc.data() as PersonaForFirestore)
		.filter((persona) => typeof persona.name === 'string' && persona.name.length > 0);
	const rows: NameRow[] = resolveNames(personas);

	const topicCount = new Set(rows.map((row) => row.topicId)).size;
	console.log(`ペルソナ ${rows.length}体 / トピック ${topicCount}件`);
	printRoster(rows, personas);

	printSurnameConcentration(rows, topN);
	printCrossTopicReuse(rows);
	printWithinTopicCollision(rows);
	printBanned(rows);
	printRealWorldHeadCoverage(rows);
	printRegionalFit(rows);
	printOriginBreakdown(rows);
	printSurnameSelfReference(rows);
	printSeparatorViolations(rows);
	printGivenNames(rows, topN);
};

/**
 * 姓と名に割る。日本人名は「姓 名」（半角スペース1つ）の表記規則があるためそこで割るが、
 * 規則が守られず区切りの無い名前が実際に出ている。区切りなしを姓不明として捨てると
 * 姓の集中度を過小評価するため、区切りありの名前から得た姓の語彙で前方一致させて復元する。
 * カタカナ外国人名（中黒区切り）は姓の集計対象にしない。
 */
const SEPARATOR = /[\s\u3000]+/;

const resolveNames = (personas: PersonaForFirestore[]): NameRow[] => {
	const knownSurnames = new Set(
		personas
			.map((persona) => persona.name.trim())
			.filter((name) => !name.includes('・') && SEPARATOR.test(name))
			.map((name) => name.split(SEPARATOR)[0])
	);

	return personas.map((persona) => {
		const name = persona.name.trim();
		const topicId = persona.topicId ?? '(topicId不明)';
		const prose = `${persona.background ?? ''}\n${persona.interests ?? ''}`;
		const prefecture = persona.prefecture ?? '';
		const region = REGIONAL_POOL[prefecture] ? prefecture : null;
		const base = {
			topicId,
			name,
			prefecture: persona.prefecture ?? null,
			region,
			isJapaneseName: !name.includes('・'),
			country: persona.country ?? null
		};
		const withSurname = (surname: string, givenName: string): NameRow => ({
			...base,
			surname,
			givenName,
			selfReferencesSurname: surname.length > 0 && prose.includes(surname)
		});
		if (name.includes('・')) return withSurname('', '');
		const parts = name.split(SEPARATOR);
		if (parts.length >= 2) return withSurname(parts[0], parts.slice(1).join(' '));
		// 区切りなし。既知の姓のうち最も長い前方一致を姓とみなす。一致が無ければ姓不明。
		const matched = [...knownSurnames]
			.filter((surname) => name.startsWith(surname) && name.length > surname.length)
			.sort((a, b) => b.length - a.length)[0];
		if (!matched) return withSurname('', '');
		return withSurname(matched, name.slice(matched.length));
	});
};

const tally = (values: string[]): Array<[string, number]> => {
	const counts = new Map<string, number>();
	for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const printSurnameConcentration = (rows: NameRow[], topN: number): void => {
	const surnames = rows.map((row) => row.surname).filter(Boolean);
	const ranked = tally(surnames);
	const total = surnames.length;
	console.log(`\n=== 姓の頻度（日本人名 ${total}体 / 異なり ${ranked.length}種）===`);
	const cumulativeShare = (n: number) =>
		((ranked.slice(0, n).reduce((sum, [, count]) => sum + count, 0) / total) * 100).toFixed(1);
	console.log(
		`上位1姓 ${cumulativeShare(1)}% / 上位3姓 ${cumulativeShare(3)}% / 上位10姓 ${cumulativeShare(10)}%`
	);
	for (const [surname, count] of ranked.slice(0, topN)) {
		console.log(`  ${surname}\t${count}\t${((count / total) * 100).toFixed(1)}%`);
	}
};

/** 同じ姓が別トピックで繰り返し出ているか。ユーザーが「またこの姓」と感じるのはここ。 */
const printCrossTopicReuse = (rows: NameRow[]): void => {
	const topicsBySurname = new Map<string, Set<string>>();
	for (const row of rows) {
		if (!row.surname) continue;
		const topics = topicsBySurname.get(row.surname) ?? new Set<string>();
		topics.add(row.topicId);
		topicsBySurname.set(row.surname, topics);
	}
	const reused = [...topicsBySurname.entries()]
		.map(([surname, topics]) => [surname, topics.size] as const)
		.filter(([, count]) => count >= 2)
		.sort((a, b) => b[1] - a[1]);
	console.log(`\n=== トピックをまたぐ姓の再出現（2トピック以上）: ${reused.length}種 ===`);
	for (const [surname, count] of reused.slice(0, 30)) {
		console.log(`  ${surname}\t${count}トピック`);
	}
};

/** 1回の生成の中での姓の衝突。プロンプトは同一生成内の重複を明示的に禁じていない。 */
const printWithinTopicCollision = (rows: NameRow[]): void => {
	const collisions: string[] = [];
	const byTopic = new Map<string, NameRow[]>();
	for (const row of rows) byTopic.set(row.topicId, [...(byTopic.get(row.topicId) ?? []), row]);
	for (const [topicId, topicRows] of byTopic) {
		for (const [surname, count] of tally(topicRows.map((row) => row.surname))) {
			if (count >= 2) collisions.push(`  ${topicId}\t${surname} ×${count}`);
		}
	}
	console.log(`\n=== 同一トピック内での姓の重複: ${collisions.length}件 ===`);
	for (const line of collisions.slice(0, 30)) console.log(line);
};

/** 明示的に避けさせている姓・名が残っていれば、禁止指示が効いていない証拠。 */
const printBanned = (rows: NameRow[]): void => {
	const surnameHits = rows.filter((row) => BANNED_SURNAMES.includes(row.surname));
	const givenHits = rows.filter((row) =>
		BANNED_GIVEN_NAMES.some((banned) => row.givenName.includes(banned))
	);
	console.log(
		`\n=== プロンプトで避けさせている名前の残存: 姓 ${surnameHits.length}件 / 名 ${givenHits.length}件 ===`
	);
	for (const row of [...surnameHits, ...givenHits].slice(0, 20)) {
		console.log(`  ${row.name}\t(${row.topicId})`);
	}
};

/** 名前・居住地・立場の一覧。数字だけでは決まらない「その土地の人物として自然か」を人が読むための材料。 */
const printRoster = (rows: NameRow[], personas: PersonaForFirestore[]): void => {
	console.log('\n=== 名簿 ===');
	rows.forEach((row, index) => {
		const persona = personas[index];
		const where = [persona.country, persona.prefecture].filter(Boolean).join(' / ') || '(所在なし)';
		console.log(`  ${row.name}\t${where}\t${persona.role}`);
	});
};

/** 実在頻度の上位姓がどれだけ出ているか。皆無なら分布の頭が丸ごと欠けている。 */
const printRealWorldHeadCoverage = (rows: NameRow[]): void => {
	const japanese = rows.filter((row) => row.surname);
	const hits = japanese.filter((row) => MOST_COMMON_REAL_SURNAMES.includes(row.surname));
	// 平方根で均した重みのもとでの期待値。実人口比（約1割）と比べると誤読するのでこちらを出す。
	const expected = (japanese.length * 0.002).toFixed(1);
	console.log(
		`\n=== 実在頻度 上位10姓の出現: ${hits.length}/${japanese.length}体（現在の重みでの期待値 約${expected}体）===`
	);
	for (const [surname, count] of tally(hits.map((row) => row.surname))) {
		console.log(`  ${surname}\t${count}`);
	}
};

/**
 * 地域色の強い県に住む人物へ、その地域の姓が付いているか。多様な立場を代表させるアプリなので、
 * 沖縄県民の立場を代弁する人物が全国的な姓を持つのは、名前が立場を裏切っている状態にあたる。
 */
const printRegionalFit = (rows: NameRow[]): void => {
	const regional = rows.filter((row) => row.region && row.surname);
	const fitted = regional.filter((row) => REGIONAL_POOL[row.region!].has(row.surname));
	console.log(
		`\n=== 地域色の強い県の人物: ${regional.length}体 / うちその地域の姓: ${fitted.length}体 ===`
	);
	for (const row of regional) {
		const mark = REGIONAL_POOL[row.region!].has(row.surname) ? '○' : '×';
		console.log(`  ${mark} ${row.region}\t${row.name}`);
	}
};

/**
 * 出自の別の分布。日本語の姓名に閉じていないかを見る。姓の語彙テーブルを持つのは日本語名だけで、
 * それ以外の氏名は LLM が決めるため分布が狭まりうる（語彙化は本仕様の Non-Goals・測れる状態にする）。
 * 所在ではなく表記で日本語名を判定する（国を持たない日本語名の人物がいるため）。
 */
const printOriginBreakdown = (rows: NameRow[]): void => {
	const japanese = rows.filter((row) => row.isJapaneseName);
	const others = rows.filter((row) => !row.isJapaneseName);
	console.log(
		`\n=== 氏名の出自: 日本語の姓名 ${japanese.length}体 / それ以外の表記 ${others.length}体（全 ${rows.length}体）===`
	);
	for (const [country, count] of tally(others.map((row) => row.country ?? '(国なし)'))) {
		console.log(`  ${country}\t${count}`);
	}
	const withPrefecture = rows.filter((row) => row.prefecture);
	console.log(`\n=== 都道府県別の人数（都道府県を持つ ${withPrefecture.length}体）===`);
	for (const [prefecture, count] of tally(withPrefecture.map((row) => row.prefecture!))) {
		console.log(`  ${prefecture}\t${count}`);
	}
};

/**
 * 背景文が自分の姓に言及しているか。していなければ、生成後にコード側で姓を差し替えても
 * 本文と矛盾しない（＝姓の決定を LLM から取り上げられる）。
 */
const printSurnameSelfReference = (rows: NameRow[]): void => {
	const hits = rows.filter((row) => row.selfReferencesSurname);
	console.log(`\n=== 背景・関心事が自分の姓に言及: ${hits.length}/${rows.length}体 ===`);
	for (const row of hits) console.log(`  ${row.name}\t(${row.topicId})`);
};

/**
 * 「姓 名」の半角スペース区切りが守られていない件。表記ルール違反そのものであると同時に、
 * 姓を機械的に切り出せなくなるため上の姓頻度が実際より低く出る（＝集中度の過小評価）要因になる。
 */
const printSeparatorViolations = (rows: NameRow[]): void => {
	const violations = rows.filter(
		(row) => !row.name.includes('・') && !/[\s\u3000]/.test(row.name.trim())
	);
	console.log(`\n=== 「姓 名」区切りが無い日本人名: ${violations.length}件 ===`);
	for (const row of violations) console.log(`  ${row.name}\t(${row.topicId})`);
};

const printGivenNames = (rows: NameRow[], topN: number): void => {
	const ranked = tally(rows.map((row) => row.givenName));
	console.log(`\n=== 名の頻度（異なり ${ranked.length}種）===`);
	for (const [givenName, count] of ranked.slice(0, topN)) {
		if (count < 2) break;
		console.log(`  ${givenName}\t${count}`);
	}
};

const readArg = (flag: string): string | undefined => {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : undefined;
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
