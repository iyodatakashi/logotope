// ペルソナの命名が仕様どおりに出るかを、実物の LLM で確かめる検証ハーネス。
//
// **本番と同じ generatePersonas を呼ぶ**（検証と本番で経路を分けない）。プロンプト・スキーマ・
// 姓の割り当て・表示名の組み立ては本番のものが走る。Firestore へは何も書かない（使用量記録は
// 構造化ログのみ）。したがって実データを汚さずに1回の生成で確認できる。
//
// 確かめたいのは、姓の決定を LLM から取り上げた設計が実物で成立しているか:
//   1. LLM が homePrefecture を都道府県の正式表記で返すか（返さないと日本人と判定できず姓が付かない）
//   2. 地域を代表する立場に、その地域の居住地が設定されるか（沖縄県民が沖縄県になるか）
//   3. 割り当てた姓が、その居住地の地域リストから引かれているか
//   4. 表示名が「姓 名」／カタカナは「名・姓」で組み立てられているか
//   5. 外国人ペルソナで homePrefecture が空になり、カタカナ姓名がそのまま使われるか
//
// 機械判定できるのは上記まで。「その土地の人物として自然か」は人が読んで決めるので、
// 生成された全ペルソナの名前・居住地・背景の冒頭を一覧で出す。
//
// 実行:
//   cd functions
//   ANTHROPIC_API_KEY=... npx tsx src/pipeline/personas/verify-persona-naming.ts [--title "テーマ"]
import { generatePersonas } from '../../agents/persona-generator-agent.js';
import { REGIONAL_SURNAMES } from '../../constants/japanese-surnames.js';
import { PREFECTURES, SURNAME_REGION_OF_PREFECTURE } from '../../constants/surname-regions.js';
import type { Stakeholder } from '../../types/stakeholder.types.js';

/**
 * 命名の要求が最も強く出る立場を並べる。地域を代表する立場（沖縄・東北）と、
 * 日本人でない人物が混じる余地のある立場を必ず含める。
 */
const STAKEHOLDERS: Stakeholder[] = [
	{ id: 's1', role: '沖縄県の米軍基地周辺に暮らす住民', engagementLevel: 'high' },
	{ id: 's2', role: '沖縄県で観光業を営む事業者', engagementLevel: 'medium' },
	{ id: 's3', role: '東北の被災地で漁業を続ける人', engagementLevel: 'medium' },
	{ id: 's4', role: '安全保障を研究する大学教員', engagementLevel: 'high' },
	{ id: 's5', role: '在日米軍の関係者', engagementLevel: 'high' },
	{ id: 's6', role: '基地問題を意識したことのない都市部の会社員', engagementLevel: 'low' }
] as Stakeholder[];

const DEFAULT_TITLE = '在日米軍基地の集中と地域の負担';

const main = async (): Promise<void> => {
	const title = readArg('--title') ?? DEFAULT_TITLE;

	const result = await generatePersonas(title, STAKEHOLDERS, 'verify-persona-naming');
	if (!result.ok) throw new Error(`生成に失敗: ${JSON.stringify(result.error)}`);
	const personas = result.value.personas;

	console.log(`テーマ「${title}」/ ${personas.length}体\n`);
	for (const persona of personas) {
		const where = persona.homePrefecture || `(国外: ${persona.nationality})`;
		console.log(`  ${persona.name}\t${where}\t${persona.role}`);
		console.log(`    ${persona.background.slice(0, 70)}…`);
	}

	const failures: string[] = [];
	for (const persona of personas) {
		const isJapanese = persona.homePrefecture !== '';
		const [surname, ...rest] = persona.name.split(' ');

		if (isJapanese) {
			if (!PREFECTURES.includes(persona.homePrefecture)) {
				failures.push(
					`${persona.name}: 居住地「${persona.homePrefecture}」が都道府県の正式表記でない`
				);
			}
			if (rest.length === 0) {
				failures.push(`${persona.name}: 「姓 名」の形になっていない`);
			}
			const region = SURNAME_REGION_OF_PREFECTURE[persona.homePrefecture];
			// 地域姓は REGIONAL_RATIO の比率でしか引かないので、外れても失敗ではない。事実として出す。
			if (region) {
				const inRegion = REGIONAL_SURNAMES[region].some(([candidate]) => candidate === surname);
				console.log(
					`  [地域] ${persona.name} … ${region}の姓${inRegion ? 'である' : 'ではない（全国の姓）'}`
				);
			}
		} else if (!persona.name.includes('・')) {
			failures.push(`${persona.name}: 外国人ペルソナが「名・姓」の形になっていない`);
		}
	}

	// 立場に地域が明示されている人物が、その地域に住んでいるか
	for (const persona of personas) {
		if (persona.stakeholderRole.includes('沖縄') && persona.homePrefecture !== '沖縄県') {
			failures.push(`${persona.name}: 沖縄の立場なのに居住地が「${persona.homePrefecture}」`);
		}
	}

	console.log(
		`\n${failures.length === 0 ? '機械判定: 問題なし' : `機械判定: ${failures.length}件`}`
	);
	for (const failure of failures) console.log(`  × ${failure}`);
};

const readArg = (flag: string): string | undefined => {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : undefined;
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
