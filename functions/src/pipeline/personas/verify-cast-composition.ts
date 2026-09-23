// キャスト構成が指示どおりかを、実物の LLM で確かめる検証ハーネス。
//
// **本番と同じ generateStakeholders → generatePersonas を順に呼ぶ**（検証と本番で経路を分けない）。
// 立場リストをハードコードしない: 立場そのものが検査対象だからである。旧ハーネスは沖縄・東北の
// 6立場を固定しており、①誰かが事前に想像できた立場しか試せず、②「地域を代表する立場は沖縄と東北」
// という日本中心の前提を検証側に焼き付けていた。後者は本仕様が正す対象そのものなので持ち込まない。
//
// Firestore へは何も書かない（使用量記録は構造化ログのみ）。
//
// 機械判定は LLM の出力を対象とする項目に限る:
// 判定の規則そのものは cast-composition-checks.ts に純関数として置き、単体テストで確かめている
// （LLM を呼ばずに規則を検証できる）。ここはテーマを通して結果を提示する側に徹する。
//
// 各検査を「何件に対して実施したか」を必ず出す。地域姓の整合はテーマが地域性を問うたときだけ
// 走るため、0件は異常ではない。0件と未実施を読み手が区別できるようにするための件数表示である。
//
// 機械判定できない観点（その舞台の人物として自然か、問われていることの当事者が場にいるか）は
// 判定せず、人が読んで決めるための一覧として提示する。
//
// 実行:
//   cd functions
//   ANTHROPIC_API_KEY=... GEMINI_API_KEY=... npx tsx src/pipeline/personas/verify-cast-composition.ts \
//     [--title "テーマ"] [--description "詳細説明"]
//
// 引数なしで実行すると、国内向け・国外向けの既定テーマを両方通す。
import { generateStakeholders } from '../../agents/stakeholder-agent.js';
import { generatePersonas } from '../../agents/persona-generator-agent.js';
import type { GeneratedPersona } from '../../agents/persona-generator-agent.js';
import { runCastCompositionChecks } from './cast-composition-checks.js';
import type { Check } from './cast-composition-checks.js';
import type { Stakeholder } from '../../types/stakeholder.types.js';

type Theme = { label: string; title: string; description?: string };

/**
 * 既定テーマ。国内向けは「地域に結びつく立場が確実に生成されるもの」を選ぶ。既定テーマが
 * 担保するのは地域性の検査が走ることであって、どの土地が出るかではない。
 */
const DEFAULT_THEMES: Theme[] = [
	{
		label: '国内',
		title: '在日米軍基地の集中と地域の負担',
		description:
			'基地を抱える地域の住民が、日々の生活で何を引き受けているのかを本人たちに語らせたい。'
	},
	{
		label: '国外',
		title: '米国のLLM開発企業が相次いでAI開発の減速を主張し始めた。その背景に何があるのか',
		description:
			'減速を主張している開発企業の当事者自身に、危機認識と社内事情を語らせたい。米中それぞれの開発プレイヤーとその周囲が何を考えているのかを知りたい。'
	}
];

const main = async (): Promise<void> => {
	const title = readArg('--title');
	const themes: Theme[] = title
		? [{ label: '指定', title, description: readArg('--description') }]
		: DEFAULT_THEMES;

	for (const theme of themes) {
		await runTheme(theme);
	}
};

const runTheme = async (theme: Theme): Promise<void> => {
	console.log(`\n${'='.repeat(78)}\n【${theme.label}】${theme.title}`);
	if (theme.description) console.log(`詳細説明: ${theme.description}`);
	console.log('='.repeat(78));

	const topicContext = theme.description ? { description: theme.description } : undefined;

	const stakeholderResult = await generateStakeholders(theme.title, topicContext);
	if (!stakeholderResult.ok) {
		throw new Error(`立場の生成に失敗: ${JSON.stringify(stakeholderResult.error)}`);
	}
	// 永続はしないが、以降の突合は本番と同じ「id を持つ立場」で行う。
	const stakeholders: Stakeholder[] = stakeholderResult.value.stakeholders.map(
		(stakeholder, index) => ({ ...stakeholder, id: `verify-${index + 1}` })
	);

	const personaResult = await generatePersonas(
		theme.title,
		stakeholders,
		'verify-cast-composition',
		topicContext
	);
	if (!personaResult.ok) {
		throw new Error(`人物の生成に失敗: ${JSON.stringify(personaResult.error)}`);
	}
	const personas = personaResult.value.personas;

	printStakeholders(stakeholders);
	printPersonas(personas);
	printChecks(runCastCompositionChecks(personas));
};

/** 人手判定の材料。問われていることの当事者が場にいるかは、ここを人が読んで決める。 */
const printStakeholders = (stakeholders: Stakeholder[]): void => {
	console.log(`\n--- 生成された立場 ${stakeholders.length}件（人手判定）---`);
	for (const stakeholder of stakeholders) {
		const location = [stakeholder.country, stakeholder.prefecture].filter(Boolean).join('・');
		console.log(`  ${stakeholder.role}`);
		console.log(`    当事者である理由: ${stakeholder.stakeReason}`);
		console.log(
			`    当事者性:${stakeholder.stakeLevel} / 少数性:${stakeholder.minorityLevel} / 専門・意識:${stakeholder.engagementLevel} / 所在: ${location || '(なし)'}`
		);
	}
	printDistribution(stakeholders);
};

const printDistribution = (stakeholders: Stakeholder[]): void => {
	const tally = (values: string[]): string =>
		['high', 'medium', 'low']
			.map((level) => `${level} ${values.filter((v) => v === level).length}`)
			.join(' / ');
	console.log(`\n  3軸の分布（射程を絞った後も幅が残っているかを人が見る）`);
	console.log(`    当事者性  : ${tally(stakeholders.map((s) => s.stakeLevel))}`);
	console.log(`    少数性    : ${tally(stakeholders.map((s) => s.minorityLevel))}`);
	console.log(`    専門・意識: ${tally(stakeholders.map((s) => s.engagementLevel))}`);

	const countries = stakeholders.map((s) => s.country ?? '(なし)');
	const unique = [...new Set(countries)];
	console.log(
		`    国の内訳  : ${unique.map((country) => `${country} ${countries.filter((c) => c === country).length}`).join(' / ')}`
	);
};

/** 舞台の人物として氏名・所在・背景が自然かを、人が読んで決めるための一覧。 */
const printPersonas = (personas: GeneratedPersona[]): void => {
	console.log(`\n--- 生成された人物 ${personas.length}体（人手判定）---`);
	for (const persona of personas) {
		const location = [persona.country, persona.prefecture].filter(Boolean).join('・');
		console.log(`  ${persona.name}\t${location || '(所在なし)'}\t${persona.role}`);
		console.log(`    ${persona.background.slice(0, 70)}…`);
	}
};

const printChecks = (checks: Check[]): void => {
	console.log('\n--- 機械判定 ---');
	for (const check of checks) {
		const verdict = check.failures.length === 0 ? '問題なし' : `${check.failures.length}件`;
		console.log(`  ${check.name}: ${check.checked}体に実施 → ${verdict}`);
		for (const note of check.notes) console.log(`    ${note}`);
		for (const failure of check.failures) console.log(`    × ${failure}`);
	}
	const total = checks.reduce((sum, check) => sum + check.failures.length, 0);
	console.log(`  合計: ${total}件の失敗`);
};

const readArg = (flag: string): string | undefined => {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : undefined;
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
