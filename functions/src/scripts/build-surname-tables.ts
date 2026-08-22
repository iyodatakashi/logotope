/**
 * 日本人ペルソナの姓テーブル（constants/japanese-surnames.ts）を実データから生成する。
 *
 * 姓を LLM に選ばせると分布が極端に狭くなるため、姓の語彙と頻度はコード側で持つ。その語彙を手書きの
 * 記憶で作ると量が頭打ちになり、地域姓がすぐ一巡する。そこで実在のデータから機械的に作る。
 *
 * 出典:
 *   1. 姓の全国頻度（上位5000・人口推計付き）
 *      https://github.com/siikamiika/japanese-family-names （名字由来net のランキングより）
 *   2. 姓の見出し語（約12000）
 *      mecab-ipadic の Noun.name.csv（人名・姓）https://github.com/taku910/mecab
 *   3. 全国の町字名（郵便番号データ由来）
 *      https://github.com/rinkei/jipcode
 *
 * 地域姓の導出:
 *   日本の姓は地名由来が多い。「ある地方の県にしか存在しない町字名」と「実在する姓」の積を取ると、
 *   その土地に根のある姓が得られる（沖縄なら 比嘉・具志堅・喜屋武 など）。ただし全国的に多い姓は
 *   偶然その地名と一致しているだけなので、全国順位が上位のものは地域姓から除く。
 *   機械的な導出で漏れる著名な地域姓（他県にも同名の地名がある等）は CURATED_SUPPLEMENTS で補う。
 *
 * 実行:
 *   cd functions
 *   git clone --depth 1 https://github.com/rinkei/jipcode /tmp/jipcode
 *   npx tsx src/scripts/build-surname-tables.ts --jipcode /tmp/jipcode
 */
import { writeFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SURNAME_REGION_OF_PREFECTURE, type SurnameRegion } from '../constants/surname-regions.js';

const RANKING_URL =
	'https://raw.githubusercontent.com/siikamiika/japanese-family-names/master/myoji-yurai.csv';
const IPADIC_URL =
	'https://raw.githubusercontent.com/taku910/mecab/master/mecab-ipadic/Noun.name.csv';

/** 全国順位がこれより上位の姓は「全国的な姓」とみなし、地域姓には採らない */
const NATIONAL_RANK_CUTOFF = 300;

/** 上位5000に入らない姓（人口推計を持たない）に与える重み。ランキング下限より小さく置く */
const UNRANKED_WEIGHT = 1000;

/**
 * 人口推計をそのまま抽選確率にすると上位の姓が支配し、実効的な種類数が一覧の 1/4〜1/10 まで落ちて
 * 「また同じ姓」が起きる。平方根で均すことで、多い姓ほど出やすいという順序は保ったまま
 * 実効的な種類数を一覧の規模に近づける（沖縄 50→100、東北 30→223 種相当）。
 */
const dampen = (population: number): number => Math.round(Math.sqrt(population));

/**
 * 地名との一致では拾えないが、その地域を代表する姓。他県にも同名の地名があるために機械的な
 * 導出から漏れるものを、実在コーパスに載っていることを確かめた上で補う。
 */
const CURATED_SUPPLEMENTS: Record<SurnameRegion, string[]> = {
	沖縄: [
		'金城',
		'大城',
		'宮城',
		'上原',
		'玉城',
		'平良',
		'知念',
		'山城',
		'又吉',
		'国吉',
		'神谷',
		'仲村',
		'宮里',
		'仲間',
		'新里',
		'宮平',
		'赤嶺',
		'大山',
		'兼城',
		'座間味',
		'名嘉',
		'桃原',
		'大浜',
		'真栄城',
		'金武',
		'石垣',
		'譜久里',
		'仲程',
		'普天間',
		'恩河'
	],
	東北: [
		'佐々木',
		'菅原',
		'工藤',
		'及川',
		'小野寺',
		'熊谷',
		'八重樫',
		'大友',
		'成田',
		'三上',
		'福士',
		'対馬',
		'奈良岡',
		'葛西',
		'五十嵐',
		'我妻',
		'布施',
		'畠山',
		'相馬',
		'佐久間',
		'庄子',
		'只野',
		'鎌田',
		'沼田',
		'長谷部',
		'関口',
		'鈴木'
	],
	北陸: ['本間', '桑原', '丸山', '表', '東出', '高瀬', '川端', '米沢', '舟木', '数川'],
	南九州: [
		'黒木',
		'甲斐',
		'長友',
		'日高',
		'押川',
		'有村',
		'鮫島',
		'肝付',
		'税所',
		'中馬',
		'川畑',
		'迫',
		'溝口',
		'上妻',
		'福留',
		'山之内',
		'宇都',
		'図師',
		'種子田',
		'東',
		'園田',
		'牧瀬',
		'瀬戸山',
		'内薗',
		'大迫'
	],
	北部九州: [
		'古賀',
		'江口',
		'副島',
		'鶴田',
		'原口',
		'中原',
		'峰',
		'川原',
		'田尻',
		'光武',
		'井手',
		'牛島',
		'諸熊',
		'執行',
		'深川',
		'大津',
		'龍',
		'池松',
		'納富',
		'香月'
	],
	近畿: [
		'岡本',
		'前川',
		'中井',
		'川西',
		'東野',
		'玉置',
		'上野山',
		'阪本',
		'岸本',
		'辻',
		'奥野',
		'木本',
		'寺西',
		'喜多',
		'小西',
		'津田',
		'中辻',
		'藤堂',
		'芝',
		'南出'
	],
	中国四国: [
		'沖田',
		'三宅',
		'曽我部',
		'公文',
		'高岡',
		'土居',
		'門田',
		'守屋',
		'越智',
		'藤原',
		'原',
		'別府',
		'安芸',
		'国広',
		'大月',
		'宇高',
		'真鍋',
		'香川',
		'一色',
		'徳弘'
	]
};

type Entry = [string, number];

const main = async (): Promise<void> => {
	const jipcodePath = readArg('--jipcode');
	if (!jipcodePath)
		throw new Error('--jipcode <path> に jipcode のチェックアウト先を指定してください');

	const ranking = await fetchRanking();
	const attested = new Set([...ranking.keys(), ...(await fetchIpadicSurnames())]);
	const prefecturesOfTown = await readTowns(join(jipcodePath, 'zipcode', 'latest'));

	const rankOf = new Map([...ranking.keys()].map((surname, index) => [surname, index + 1]));
	const weightOf = (surname: string) => dampen(ranking.get(surname) ?? UNRANKED_WEIGHT);

	// 地域ごとに「その地域の県にしか無い町字名」かつ「実在する姓」かつ「全国上位ではない」を集める
	const prefecturesOfRegion = new Map<SurnameRegion, Set<string>>();
	for (const [prefecture, region] of Object.entries(SURNAME_REGION_OF_PREFECTURE)) {
		const set = prefecturesOfRegion.get(region) ?? new Set<string>();
		set.add(prefecture);
		prefecturesOfRegion.set(region, set);
	}

	const regional: Record<string, Entry[]> = {};
	for (const [region, prefectures] of prefecturesOfRegion) {
		const surnames = new Set<string>();
		for (const [town, towns] of prefecturesOfTown) {
			if (!attested.has(town)) continue;
			// その地方の県だけに存在する地名を採る。地名が2県以下にしか無く片方がその地方なら、
			// その土地に根のある姓とみなして採る（薄い地方でも十分な数を確保するため）。
			const insideRegion = [...towns].filter((prefecture) => prefectures.has(prefecture));
			if (insideRegion.length === 0) continue;
			if (insideRegion.length < towns.size && towns.size > 2) continue;
			if ((rankOf.get(town) ?? Number.MAX_SAFE_INTEGER) <= NATIONAL_RANK_CUTOFF) continue;
			surnames.add(town);
		}
		for (const surname of CURATED_SUPPLEMENTS[region]) {
			if (!attested.has(surname)) {
				console.warn(`[warn] 補完した姓が実在コーパスに無い: ${region} ${surname}`);
				continue;
			}
			surnames.add(surname);
		}
		regional[region] = [...surnames]
			.map((surname): Entry => [surname, weightOf(surname)])
			.sort((a, b) => b[1] - a[1]);
	}

	const national: Entry[] = [...ranking.keys()]
		.map((surname): Entry => [surname, weightOf(surname)])
		.sort((a, b) => b[1] - a[1]);
	// このスクリプトは src/ から tsx で直接動かす前提（生成物をコミットするので lib/ からは動かさない）
	writeFileSync(
		join(process.cwd(), 'src/constants/japanese-surnames.ts'),
		render(national, regional)
	);
	console.log(`全国 ${national.length}姓`);
	for (const [region, entries] of Object.entries(regional)) {
		console.log(
			`${region} ${entries.length}姓  例: ${entries
				.slice(0, 8)
				.map(([s]) => s)
				.join(' ')}`
		);
	}
};

const fetchRanking = async (): Promise<Map<string, number>> => {
	const text = await (await fetch(RANKING_URL)).text();
	return new Map(
		text
			.split('\n')
			.filter((line) => line.includes(','))
			.map((line) => {
				const [surname, population] = line.trim().split(',');
				return [surname, Number(population)] as const;
			})
	);
};

const fetchIpadicSurnames = async (): Promise<string[]> => {
	const buffer = await (await fetch(IPADIC_URL)).arrayBuffer();
	const text = new TextDecoder('euc-jp').decode(buffer);
	return text
		.split('\n')
		.map((line) => line.split(','))
		.filter((fields) => fields[6] === '人名' && fields[7] === '姓')
		.map((fields) => fields[0]);
};

/** 町字名 → その名前が存在する都道府県の集合 */
const readTowns = async (directory: string): Promise<Map<string, Set<string>>> => {
	const files = (await readdir(directory)).filter((name) => name.endsWith('.csv'));
	const result = new Map<string, Set<string>>();
	for (const file of files) {
		const text = await readFile(join(directory, file), 'utf-8');
		for (const line of text.split('\n')) {
			const fields = line.split(',');
			if (fields.length < 4) continue;
			const prefecture = fields[1];
			const town = fields[3].replace(/（.*$/, '').replace(/^字/, '').replace(/丁目$/, '');
			// 漢字だけ・2文字以上を姓の候補とする（かな交じりや「以下に掲載がない場合」等を除く）
			if (town.length < 2 || !/^[一-鿿]+$/.test(town)) continue;
			const set = result.get(town) ?? new Set<string>();
			set.add(prefecture);
			result.set(town, set);
		}
	}
	return result;
};

const render = (national: Entry[], regional: Record<string, Entry[]>): string => {
	const format = (entries: Entry[]) =>
		entries.map(([surname, weight]) => `\t['${surname}', ${weight}]`).join(',\n');
	return `// 自動生成ファイル。scripts/build-surname-tables.ts が書き出す。手で編集しない。
// 各要素は [姓, 重み]。抽選はこの重みに比例させる。重みは全国の人口推計を平方根で均した値で、
// 「多い姓ほど出やすい」順序は保ちつつ、上位の姓が支配して繰り返しになるのを避ける。
import type { SurnameRegion } from './surname-regions.js';

export const NATIONAL_SURNAMES: ReadonlyArray<readonly [string, number]> = [
${format(national)}
];

export const REGIONAL_SURNAMES: Record<SurnameRegion, ReadonlyArray<readonly [string, number]>> = {
${Object.entries(regional)
	.map(([region, entries]) => `\t${region}: [\n${format(entries).replace(/^\t/gm, '\t\t')}\n\t]`)
	.join(',\n')}
};
`;
};

const readArg = (flag: string): string | undefined => {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : undefined;
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
