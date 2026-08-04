// 意欲評価・気づき検出の A/B 検証ハーネス。討論コストの半分を占める evaluateEngagement について、
// 「安くする案」を実データで採否判定する。比較できるのは2種類（--compare）:
//   model  … モデルを差し替える（既定の Sonnet 5 ↔ Haiku 4.5）※検証済み: 不採用
//   layout … 気づきセクションの置き場所を差し替える（inline ↔ cached-prefix）※検証済み: 採用
//   rubric … 判定基準もキャッシュ側へ出すか（cached-prefix ↔ cached-rubric）
//
// **本番と同じ evaluateEngagement を呼ぶ**（検証と本番で経路を分けない）。変数は上のどちらか一方だけで、
// プロンプト・スキーマ・後処理（score クランプ・mode 解決・気づきの発生源ガード）は本番のものが走る。
//
//   機械判定（ここで自動）:
//     - 討論の挙動を決める閾値判定の一致率（発言する >=3 / キューに積む >=4 / 章を続ける >=4）
//     - score の一致・平均絶対差、mode の一致率、intentSummary の有無の一致率
//     - 気づきの有無の一致率と、本番で気づきが出た地点での再現率
//     - 実測トークンからの1回あたり単価
//   人が判定（ここでは判定しない）: 気づき本文・intentSummary の中身の妥当性
//     → JSON レポートに3試行を並べて出力するので、それを読んで決める。
//
// 判定の考え方: baseline を2回走らせた差＝同じ条件でも出る揺れ（ノイズ床）。candidate との差がこの床と
// 同程度なら、討論の挙動は実質変わらないと判断してよい。床より明確に大きければ採用しない。
//
// 既知の近似: 評価時点で場に出ていた論点（activeAgendaItem）はターンに永続していないため、章の先頭論点
// （なければ章タイトル）で代用する。両モデルに同一値を渡すのでモデル比較は成立するが、本番実績の
// 再現ではない。したがって比較の基準は「永続済みの本番値」ではなく「この場で走らせた Sonnet」に置く。
//
// 実行:
//   cd functions
//   ANTHROPIC_API_KEY=... npx tsx src/pipeline/debate/verify-engagement-model.ts \
//     --topic <topicId> [--cases 40] [--compare model|layout] [--awareness-ratio 0.3]
//   --topic なしで実行すると討論済みトピックの一覧（規模・ターン間隔つき）を出す。
//   プロンプト内訳を測るときは --awareness-ratio 0（陽性への寄せを外す）。

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { LanguageModel } from 'ai';
import {
	evaluateEngagement,
	type EngagementUsage,
	type EngagementPromptParts,
	type EngagementPromptLayout
} from '../../agents/persona-agent.js';
import { haiku } from '../../llm/models.js';
import { getPersonasByTopicId } from '../personas/personas.js';
import { getChaptersByTopicId } from './chapter.js';
import {
	SPEAK_THRESHOLD_SCORE,
	QUEUE_THRESHOLD_SCORE,
	CONTINUE_CHAPTER_THRESHOLD
} from '../../constants/debate.constants.js';
import type { Engagement } from '../../types/debate.types.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Persona } from '../../types/persona.types.js';

// 2026-08 時点の標準価格（USD / 100万トークン）。Sonnet 5 は 2026-08-31 まで導入価格 $2/$10 のため、
// この試算は実請求よりやや高く出る。キャッシュは読み 0.1倍・書き 1.25倍。
const PRICING_USD_PER_MTOK = {
	sonnet: { input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15 },
	haiku: { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 }
} as const;

const DEFAULT_CASE_COUNT = 40;
// 本番で気づきが出た地点をサンプルに混ぜる比率。気づきは大半が null で、素直に等間隔で引くと
// 陽性ケースがほぼ入らず再現率を測れないため、意図的に寄せる。
const AWARENESS_CASE_RATIO = 0.3;

// functions/ で実行する前提（実行方法は冒頭のコメント参照）。出力先は .gitignore 済み。
const OUT_DIR = join(process.cwd(), 'src/pipeline/debate/verify');

type EvaluationCase = {
	chapterIndex: number;
	chapterTitle: string;
	turnId: string;
	turnIndexInChapter: number;
	lastSpeaker: string;
	persona: Persona;
	allPersonas: Persona[]; // 会話整形（話者名の解決）に使う。本番の呼び出しと同じく全員を渡す
	turns: DebateTurn[];
	activeAgendaItem: string;
	otherPersonaNames: string[];
	// 本番（Sonnet）がこの地点でこのペルソナに気づきを記録していたか
	awarenessInProduction: boolean;
};

// 3試行の役割。baseline を2回走らせて「同一条件でも出る揺れ（ノイズ床）」を取り、
// candidate との差がその床に収まるかで採否を判断する。
type TrialLabel = 'baseline' | 'baseline-repeat' | 'candidate';

/** 比較モード。変数を1つに絞るため、モデルか配置のどちらか一方だけを差し替える */
type CompareMode = 'model' | 'layout' | 'rubric';

const TRIAL_LABELS = [
	'baseline',
	'baseline-repeat',
	'candidate'
] as const satisfies ReadonlyArray<TrialLabel>;

type VariantSpec = {
	name: string;
	model?: LanguageModel;
	promptLayout?: EngagementPromptLayout;
	pricing: keyof typeof PRICING_USD_PER_MTOK;
};

const VARIANTS: Record<CompareMode, Record<TrialLabel, VariantSpec>> = {
	// モデル比較: プロンプトは本番のまま、モデルだけ差し替える
	model: {
		baseline: { name: 'sonnet', pricing: 'sonnet' },
		'baseline-repeat': { name: 'sonnet(2回目)', pricing: 'sonnet' },
		candidate: { name: 'haiku', model: haiku, pricing: 'haiku' }
	},
	// 配置比較: モデルは本番のまま、気づきセクションの置き場所だけ差し替える
	layout: {
		baseline: { name: 'inline', promptLayout: 'inline', pricing: 'sonnet' },
		'baseline-repeat': { name: 'inline(2回目)', promptLayout: 'inline', pricing: 'sonnet' },
		candidate: { name: 'cached-prefix', promptLayout: 'cached-prefix', pricing: 'sonnet' }
	},
	// 判定基準の配置比較: 現行（cached-prefix）に対し、score/mode の判定基準もキャッシュ側へ出す案
	rubric: {
		baseline: { name: 'cached-prefix', promptLayout: 'cached-prefix', pricing: 'sonnet' },
		'baseline-repeat': {
			name: 'cached-prefix(2回目)',
			promptLayout: 'cached-prefix',
			pricing: 'sonnet'
		},
		candidate: { name: 'cached-rubric', promptLayout: 'cached-rubric', pricing: 'sonnet' }
	}
};

type Trial = {
	label: TrialLabel;
	engagement: Engagement;
	usage: EngagementUsage;
	prompt?: EngagementPromptParts; // 内訳の集計用。生成に失敗すると undefined
	elapsedMs: number;
	// evaluateEngagement は例外を握って score 1 / none を返すため、失敗を「不一致」と誤読しないよう
	// 計測コールバックが呼ばれたか＝生成が成立したかで判別する。
	failed: boolean;
};

type CaseResult = {
	case: EvaluationCase;
	trials: Record<TrialLabel, Trial>;
};

const main = async (): Promise<void> => {
	if (!getApps().length) initializeApp({ projectId: 'logotope14' });

	const topicId = readArg('--topic');
	if (!topicId) {
		await printTopicsWithDebate();
		return;
	}
	const caseCount = Number(readArg('--cases') ?? DEFAULT_CASE_COUNT);
	// 気づきの再現率を見るときは陽性へ寄せる（既定）。プロンプト内訳を測るときは 0 にして偏りを外す
	// （気づきが出た地点は討論後半・気づきを多く抱えたペルソナに偏り、気づきセクションが大きく出る）。
	const awarenessRatio = Number(readArg('--awareness-ratio') ?? AWARENESS_CASE_RATIO);
	const compareMode = (readArg('--compare') ?? 'model') as CompareMode;
	const variants = VARIANTS[compareMode];
	if (!variants) throw new Error(`--compare は model / layout / rubric のいずれか: ${compareMode}`);

	const [personas, chapters] = await Promise.all([
		getPersonasByTopicId(topicId),
		getChaptersByTopicId(topicId)
	]);
	const selectedPersonas = personas.filter((persona) => persona.selected);
	if (selectedPersonas.length === 0) throw new Error(`選択済みペルソナがいません: ${topicId}`);

	const allCases = buildCases(selectedPersonas, chapters);
	if (allCases.length === 0) throw new Error(`評価できるターンがありません: ${topicId}`);
	const cases = sampleCases(allCases, caseCount, awarenessRatio);

	console.log(
		`トピック ${topicId}: 章 ${chapters.length} / ペルソナ ${selectedPersonas.length} / ` +
			`評価地点 ${allCases.length} 件から ${cases.length} 件を抽出` +
			`（うち本番で気づきが出た地点 ${cases.filter((one) => one.awarenessInProduction).length} 件）`
	);

	const results: CaseResult[] = [];
	for (const [index, evaluationCase] of cases.entries()) {
		// 同一ペルソナの system はプロンプトキャッシュに載るため、1ケース内は逐次で走らせる
		// （並列にすると書き込み中のキャッシュを読めず、単価が実際より高く出る）。
		const trials = {
			baseline: await runTrial('baseline', variants.baseline, evaluationCase),
			'baseline-repeat': await runTrial(
				'baseline-repeat',
				variants['baseline-repeat'],
				evaluationCase
			),
			candidate: await runTrial('candidate', variants.candidate, evaluationCase)
		};
		results.push({ case: evaluationCase, trials });
		console.log(
			`[${index + 1}/${cases.length}] ${evaluationCase.persona.name} @ 第${evaluationCase.chapterIndex + 1}章 ` +
				`turn#${evaluationCase.turnIndexInChapter} ` +
				TRIAL_LABELS.map((label) => `${variants[label].name}=${describe(trials[label])}`).join(
					' / '
				)
		);
	}

	printReport(results, variants);
	await writeReport(topicId, results, variants);
};

/**
 * --topic 未指定時の案内。討論が実際に走ったトピックを規模つきで並べる。
 * ターン間隔も出す: 同一ペルソナの意欲評価はターンごとに1回なので、この間隔がプロンプトキャッシュの
 * 5分 TTL を超えると毎ターン書き直しになり、単価が跳ねる（TTL 延長を検討する判断材料）。
 */
const printTopicsWithDebate = async (): Promise<void> => {
	const topics = await getFirestore().collection('topics').get();
	console.log('--topic <topicId> を指定してください。討論済みのトピック:');
	for (const topicDoc of topics.docs) {
		const chapters = await getChaptersByTopicId(topicDoc.id);
		const turnCount = chapters.reduce((total, chapter) => total + chapter.turns.length, 0);
		if (turnCount === 0) continue;
		const gapsSec = chapters.flatMap(
			(chapter) =>
				chapter.turns
					.slice(1)
					.map(
						(turn, index) =>
							turn.createdAt.toMillis() / 1000 - chapter.turns[index].createdAt.toMillis() / 1000
					)
					.filter((gap) => gap > 0 && gap < 3600) // 中断・再開をまたいだ異常値は外す
		);
		const sorted = [...gapsSec].sort((a, b) => a - b);
		const medianGap = sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
		const overTtl = gapsSec.filter((gap) => gap > 300).length / (gapsSec.length || 1);
		console.log(
			`  ${topicDoc.id}  章${chapters.length} / ターン${String(turnCount).padStart(4)} / ` +
				`ターン間隔 中央値${medianGap.toFixed(0)}秒・5分超${pct(overTtl)}  ` +
				`${(topicDoc.data() as { title?: string }).title ?? ''}`
		);
	}
};

/**
 * 評価地点を列挙する。本番の末尾評価（evaluateReactionsForCommittedTurn）と同じ形にする:
 * 「章の各ターンを直前発言として、その話者以外の全ペルソナ」が1件ずつの評価地点になる。
 */
const buildCases = (
	personas: Persona[],
	chapters: ReadonlyArray<{
		id: string;
		chapterIndex: number;
		title: string;
		agenda: string[];
		turns: DebateTurn[];
	}>
): EvaluationCase[] => {
	// 気づきは討論の進行とともに増える。Firestore から読めるのは最終状態なので、そのまま渡すと
	// 序盤のターンに未来の気づきを見せてしまい、プロンプトが実際より大きく・内容も先読みになる。
	// 全章通しのターン順を作り、「その時点までに得ていた気づき」だけに切って渡す。
	const turnOrder = new Map<string, number>();
	for (const chapter of chapters) {
		for (const turn of chapter.turns) turnOrder.set(turn.id, turnOrder.size);
	}
	const personaAsOf = (persona: Persona, currentTurnId: string): Persona => {
		const currentOrder = turnOrder.get(currentTurnId) ?? Number.POSITIVE_INFINITY;
		return {
			...persona,
			awarenesses: (persona.awarenesses ?? []).filter((awareness) => {
				// 由来ターンが見つからない気づき（破棄済みターン由来）は再現できないので落とす
				const order = turnOrder.get(awareness.triggeredByTurnId);
				return order !== undefined && order <= currentOrder;
			})
		};
	};

	const cases: EvaluationCase[] = [];
	for (const chapter of chapters) {
		// 論点は評価時点の値が残らないため章の先頭論点で代用する（両モデルに同一値を渡す）
		const activeAgendaItem = chapter.agenda[0] ?? chapter.title;
		for (const [turnIndex, turn] of chapter.turns.entries()) {
			const turnsUpToHere = chapter.turns.slice(0, turnIndex + 1);
			const speakerName = turn.personaId
				? (personas.find((persona) => persona.id === turn.personaId)?.name ?? '不明')
				: '司会';
			for (const persona of personas) {
				if (persona.id === turn.personaId) continue; // 自分の発言には反応しない
				cases.push({
					chapterIndex: chapter.chapterIndex,
					chapterTitle: chapter.title,
					turnId: turn.id,
					turnIndexInChapter: turnIndex,
					lastSpeaker: speakerName,
					persona: personaAsOf(persona, turn.id),
					allPersonas: personas,
					turns: turnsUpToHere,
					activeAgendaItem,
					otherPersonaNames: personas
						.filter((other) => other.id !== persona.id)
						.map((other) => other.name),
					awarenessInProduction: (persona.awarenesses ?? []).some(
						(awareness) => awareness.triggeredByTurnId === turn.id
					)
				});
			}
		}
	}
	return cases;
};

/**
 * 気づきの陽性ケースを一定割合で混ぜつつ、残りは等間隔で引く。
 * 実行ごとに同じケースを引く（ランダムにしない）ので、再実行で差分を追える。
 */
const sampleCases = (
	allCases: EvaluationCase[],
	caseCount: number,
	awarenessRatio: number
): EvaluationCase[] => {
	if (allCases.length <= caseCount) return allCases;
	const positives = allCases.filter((one) => one.awarenessInProduction);
	const positiveQuota = Math.min(positives.length, Math.round(caseCount * awarenessRatio));
	const pickedPositives = pickEvenly(positives, positiveQuota);
	const pickedIds = new Set(pickedPositives.map(caseKey));
	const rest = allCases.filter((one) => !pickedIds.has(caseKey(one)));
	return [...pickedPositives, ...pickEvenly(rest, caseCount - pickedPositives.length)].sort(
		(a, b) =>
			a.chapterIndex - b.chapterIndex ||
			a.turnIndexInChapter - b.turnIndexInChapter ||
			a.persona.name.localeCompare(b.persona.name)
	);
};

const pickEvenly = <T>(items: T[], count: number): T[] => {
	if (count <= 0) return [];
	if (items.length <= count) return items;
	const stride = items.length / count;
	return Array.from({ length: count }, (_unused, index) => items[Math.floor(index * stride)]);
};

const caseKey = (evaluationCase: EvaluationCase): string =>
	`${evaluationCase.turnId}:${evaluationCase.persona.id}`;

/** 本番の evaluateEngagement をモデルだけ差し替えて1回走らせ、結果と実測トークンを記録する */
const runTrial = async (
	label: TrialLabel,
	variant: VariantSpec,
	evaluationCase: EvaluationCase
): Promise<Trial> => {
	let usage: EngagementUsage | undefined;
	let prompt: EngagementPromptParts | undefined;
	const startedAt = Date.now();
	const engagement = await evaluateEngagement(
		evaluationCase.persona,
		[...evaluationCase.turns],
		evaluationCase.otherPersonaNames,
		evaluationCase.allPersonas,
		evaluationCase.activeAgendaItem,
		{
			// 指定のない側は本番の既定（sonnet / inline 配置）をそのまま使う
			...(variant.model && { model: variant.model }),
			...(variant.promptLayout && { promptLayout: variant.promptLayout }),
			onUsage: (measured) => {
				usage = measured;
			},
			onPrompt: (parts) => {
				prompt = parts;
			}
		}
	);
	return {
		label,
		engagement,
		usage: usage ?? {
			inputTokens: 0,
			cachedInputTokens: 0,
			cacheCreationInputTokens: 0,
			outputTokens: 0
		},
		prompt,
		elapsedMs: Date.now() - startedAt,
		failed: usage === undefined
	};
};

/**
 * ユーザーメッセージの内訳を出す。単価の8割はここ（毎ターン都度課金される入力）なので、
 * 削る候補ごとに「何文字＝いくら」を並べて、削減額と失う情報を天秤にかけられるようにする。
 * 文字数→トークンは実測（同じ試行の都度入力トークン ÷ userContent 文字数）で換算する。
 */
const printPromptBreakdown = (results: CaseResult[]): void => {
	const samples = results
		.map((result) => result.trials.baseline)
		.filter((trial): trial is Trial & { prompt: EngagementPromptParts } => !!trial.prompt);
	if (samples.length === 0) return;

	const promptChars = (parts: EngagementPromptParts): number =>
		parts.userContent.length + parts.cachedPrefix.length;
	// 換算率は「送った全入力トークン ÷ 全文字数」で取る。都度入力だけで割ると、キャッシュへ回した分が
	// 分子から抜けて率が小さく出る（baseline がキャッシュ配置のときに効く）。
	const tokensPerChar = mean(
		samples.map(
			(trial) =>
				(trial.usage.inputTokens +
					trial.usage.cachedInputTokens +
					trial.usage.cacheCreationInputTokens) /
				(trial.prompt.systemPrompt.length + promptChars(trial.prompt))
		)
	);
	const segment = (label: string, pick: (parts: EngagementPromptParts) => string) => ({
		label,
		chars: mean(samples.map((trial) => pick(trial.prompt).length))
	});
	const variable = [
		segment('会話（直近8発言）', (parts) => parts.numberedConversation),
		segment('自分の直近発言5件', (parts) => parts.ownTurnsSection),
		segment('蓄積された気づき', (parts) => parts.awarenessSection),
		segment('論点アンカー', (parts) => parts.agendaAnchor),
		segment('参加者一覧', (parts) => parts.otherPersonasNote)
	];
	const totalChars = mean(samples.map((trial) => promptChars(trial.prompt)));
	const fixedChars = totalChars - variable.reduce((sum, one) => sum + one.chars, 0);

	console.log('\n=== ユーザーメッセージの内訳（都度課金される入力）===');
	console.log(
		`実測 ${tokensPerChar.toFixed(2)} トークン/文字 で換算。全体 ${Math.round(totalChars)} 文字\n`
	);
	const rows = [{ label: '固定の指示文（毎回同一）', chars: fixedChars }, ...variable].sort(
		(a, b) => b.chars - a.chars
	);
	for (const row of rows) {
		const tokens = row.chars * tokensPerChar;
		const costPerCall = (tokens * PRICING_USD_PER_MTOK.sonnet.input) / 1_000_000;
		console.log(
			`${row.label.padEnd(24)} ${Math.round(row.chars).toString().padStart(5)}字 / ` +
				`${Math.round(tokens).toString().padStart(5)}tok / ` +
				`$${costPerCall.toFixed(5)}/回 (${pct(row.chars / totalChars)})`
		);
	}
};

const describe = (trial: Trial): string =>
	trial.failed
		? '生成失敗'
		: `${trial.engagement.score}/${trial.engagement.mode}${trial.engagement.awareness ? '/気づき有' : ''}`;

const printReport = (allResults: CaseResult[], variants: Record<TrialLabel, VariantSpec>): void => {
	// 生成に失敗した試行は score 1 / none に化けるため、比較からも単価からも除く（不一致と誤読しない）
	const failures = TRIAL_LABELS.map((label) => ({
		label,
		count: allResults.filter((result) => result.trials[label].failed).length
	})).filter((entry) => entry.count > 0);
	if (failures.length > 0) {
		console.log(
			`\n⚠ 生成に失敗した試行: ${failures.map((entry) => `${entry.label} ${entry.count}件`).join(' / ')}` +
				'（当該ケースは集計から除外。件数が多いならモデル指定・APIキー・レート制限を疑う）'
		);
	}
	const results = allResults.filter((result) =>
		TRIAL_LABELS.every((label) => !result.trials[label].failed)
	);
	if (results.length === 0) {
		console.log('全ケースが失敗したため集計できない。');
		return;
	}
	console.log(`\n集計対象: ${results.length}/${allResults.length} ケース`);

	const noiseFloor = compare(results, 'baseline', 'baseline-repeat');
	const versusHaiku = compare(results, 'baseline', 'candidate');

	console.log(
		`\n=== 一致率（左: ${variants.baseline.name} 同士＝ノイズ床 / 右: ${variants.baseline.name} vs ${variants.candidate.name}）===`
	);
	const row = (label: string, a: number, b: number): void =>
		console.log(`${label.padEnd(28)} ${pct(a).padStart(7)}   ${pct(b).padStart(7)}`);
	row('発言する判定 (score>=3)', noiseFloor.speakAgreement, versusHaiku.speakAgreement);
	row('キューに積む判定 (score>=4)', noiseFloor.queueAgreement, versusHaiku.queueAgreement);
	row('章を続ける判定 (score>=4)', noiseFloor.continueAgreement, versusHaiku.continueAgreement);
	row('score 完全一致', noiseFloor.scoreExact, versusHaiku.scoreExact);
	row('score ±1 以内', noiseFloor.scoreWithinOne, versusHaiku.scoreWithinOne);
	row('mode 一致', noiseFloor.modeAgreement, versusHaiku.modeAgreement);
	row('intentSummary 有無一致', noiseFloor.intentAgreement, versusHaiku.intentAgreement);
	row('気づき有無一致', noiseFloor.awarenessAgreement, versusHaiku.awarenessAgreement);
	console.log(
		`score 平均絶対差               ${noiseFloor.scoreMeanAbsDiff.toFixed(2).padStart(7)}   ` +
			`${versusHaiku.scoreMeanAbsDiff.toFixed(2).padStart(7)}`
	);

	console.log('\n=== 気づきの検出 ===');
	const positives = results.filter((result) => result.case.awarenessInProduction);
	for (const label of TRIAL_LABELS) {
		const detected = results.filter((result) => result.trials[label].engagement.awareness);
		const recall = positives.filter((result) => result.trials[label].engagement.awareness).length;
		console.log(
			`${variants[label].name.padEnd(14)} 検出 ${detected.length}/${results.length} 件` +
				`（本番で気づきが出た ${positives.length} 地点のうち ${recall} 件で再検出）`
		);
	}

	printPromptBreakdown(results);

	console.log('\n=== 1回あたりの実測コスト ===');
	// キャッシュのヒット率はケースの並び順（同一ペルソナが再訪するまでの間隔）に左右され、本番の
	// 並び（同一ターンで全ペルソナ並列 → 次ターン）とは違う。ヒット時の単価を併記して切り分ける。
	for (const label of TRIAL_LABELS) {
		const trials = results.map((result) => result.trials[label]);
		const pricing = PRICING_USD_PER_MTOK[variants[label].pricing];
		const cost = mean(trials.map((trial) => costOf(trial.usage, pricing)));
		const elapsed = mean(trials.map((trial) => trial.elapsedMs));
		const input = mean(trials.map((trial) => trial.usage.inputTokens));
		const cached = mean(trials.map((trial) => trial.usage.cachedInputTokens));
		const written = mean(trials.map((trial) => trial.usage.cacheCreationInputTokens));
		const output = mean(trials.map((trial) => trial.usage.outputTokens));
		const hitRate =
			trials.filter((trial) => trial.usage.cachedInputTokens > 0).length / trials.length;
		// 書き込み分がすべて読み出しに変わった場合＝キャッシュが常にヒットしたときの単価
		const warmCost = mean(
			trials.map((trial) =>
				costOf(
					{
						...trial.usage,
						cachedInputTokens: trial.usage.cachedInputTokens + trial.usage.cacheCreationInputTokens,
						cacheCreationInputTokens: 0
					},
					pricing
				)
			)
		);
		console.log(
			`${variants[label].name.padEnd(14)} $${cost.toFixed(5)} / 回（常時ヒットなら $${warmCost.toFixed(5)}）  ` +
				`都度入力 ${Math.round(input)} / キャッシュ読み ${Math.round(cached)} / キャッシュ書き ${Math.round(written)} / ` +
				`出力 ${Math.round(output)} tok, ヒット率 ${pct(hitRate)}, ${(elapsed / 1000).toFixed(1)}秒`
		);
	}
	const sonnetCost = mean(
		results.map((result) => costOf(result.trials.baseline.usage, PRICING_USD_PER_MTOK.sonnet))
	);
	const haikuCost = mean(
		results.map((result) => costOf(result.trials.candidate.usage, PRICING_USD_PER_MTOK.haiku))
	);
	console.log(
		`削減率 ${pct(1 - haikuCost / sonnetCost)}（討論1本 370回換算: ` +
			`$${(sonnetCost * 370).toFixed(2)} → $${(haikuCost * 370).toFixed(2)}）`
	);
};

type Comparison = {
	speakAgreement: number;
	queueAgreement: number;
	continueAgreement: number;
	scoreExact: number;
	scoreWithinOne: number;
	scoreMeanAbsDiff: number;
	modeAgreement: number;
	intentAgreement: number;
	awarenessAgreement: number;
};

const compare = (results: CaseResult[], left: TrialLabel, right: TrialLabel): Comparison => {
	const pairs = results.map((result) => ({
		a: result.trials[left].engagement,
		b: result.trials[right].engagement
	}));
	const rate = (predicate: (pair: { a: Engagement; b: Engagement }) => boolean): number =>
		pairs.filter(predicate).length / pairs.length;
	const threshold = (limit: number) => (pair: { a: Engagement; b: Engagement }) =>
		pair.a.score >= limit === pair.b.score >= limit;
	return {
		speakAgreement: rate(threshold(SPEAK_THRESHOLD_SCORE)),
		queueAgreement: rate(threshold(QUEUE_THRESHOLD_SCORE)),
		continueAgreement: rate(threshold(CONTINUE_CHAPTER_THRESHOLD)),
		scoreExact: rate((pair) => pair.a.score === pair.b.score),
		scoreWithinOne: rate((pair) => Math.abs(pair.a.score - pair.b.score) <= 1),
		scoreMeanAbsDiff: mean(pairs.map((pair) => Math.abs(pair.a.score - pair.b.score))),
		modeAgreement: rate((pair) => pair.a.mode === pair.b.mode),
		intentAgreement: rate((pair) => !!pair.a.intentSummary === !!pair.b.intentSummary),
		awarenessAgreement: rate((pair) => !!pair.a.awareness === !!pair.b.awareness)
	};
};

const costOf = (
	usage: EngagementUsage,
	pricing: { input: number; cacheRead: number; cacheWrite: number; output: number }
): number =>
	(usage.inputTokens * pricing.input +
		usage.cachedInputTokens * pricing.cacheRead +
		usage.cacheCreationInputTokens * pricing.cacheWrite +
		usage.outputTokens * pricing.output) /
	1_000_000;

const mean = (values: number[]): number =>
	values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;

/** 気づき本文・intentSummary は人が読んで判断するため、全ケースを並べて残す */
const writeReport = async (
	topicId: string,
	results: CaseResult[],
	variants: Record<TrialLabel, VariantSpec>
): Promise<void> => {
	await mkdir(OUT_DIR, { recursive: true });
	const path = join(OUT_DIR, `engagement-model-${topicId}-${Date.now()}.json`);
	const rows = results.map((result) => ({
		章: `第${result.case.chapterIndex + 1}章 ${result.case.chapterTitle}`,
		直前発言: `turn#${result.case.turnIndexInChapter} (${result.case.lastSpeaker})`,
		発言内容: result.case.turns[result.case.turns.length - 1]?.content ?? '',
		評価者: result.case.persona.name,
		本番で気づきが出た地点: result.case.awarenessInProduction,
		...Object.fromEntries(
			TRIAL_LABELS.map((label) => [
				variants[label].name,
				{
					score: result.trials[label].engagement.score,
					mode: result.trials[label].engagement.mode,
					intentSummary: result.trials[label].engagement.intentSummary ?? null,
					awareness: result.trials[label].engagement.awareness
				}
			])
		)
	}));
	await writeFile(path, JSON.stringify({ topicId, cases: rows }, null, 2), 'utf-8');
	console.log(`\nレポート: ${path}`);
};

const readArg = (name: string): string | undefined => {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
