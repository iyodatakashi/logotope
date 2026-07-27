/**
 * topic-fact-base-enrichment の「挙動要件」を実 LLM で検証する eval ハーネス（任意実行・CI 非対象）。
 *
 * 通常の単体テスト（*.test.ts）はプロンプト内包アサーションのみで「指示が入ったこと」しか示さない。
 * 本ファイルは実際の Gemini（grounding 含む）を呼び、代表テーマ4種に対して要件別の合否シグナルを
 * LLM-judge で判定する。本仕様の挙動要件（1, 2, 7, 8）の完了判定手段。
 *
 * 実行方法:
 *   GEMINI_API_KEY=xxx ANTHROPIC_API_KEY=xxx pnpm --prefix functions eval:judge
 * （RUN_JUDGE_EVAL=1 は eval:judge スクリプトが付与する）
 *
 * GEMINI_API_KEY か RUN_JUDGE_EVAL が無ければ describe ごとスキップする。
 * 層②優先（討論ターン）はペルソナモデル（claude）を使うため ANTHROPIC_API_KEY も要る。
 * 実モデルは非決定的なため、失敗は「そのテーマ・シグナルでプロンプトが期待挙動を外した」シグナルとして読む。
 */
import { describe, it, expect } from 'vitest';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getPipelineModel } from '../../llm/models.js';
import { runFactResearch } from '../../agents/fact-research-agent.js';
import { runInterview } from '../../agents/interview-agent.js';
import { generateTurn } from '../../agents/persona-agent.js';
import type { Persona } from '../../types/persona.types.js';
import type { TopicContext } from '../../types/topic.types.js';
import type { FactBase } from '../../types/factBase.types.js';
import type { Chapter } from '../../types/chapter.types.js';
import type { Engagement } from '../../types/debate.types.js';

const ENABLED = process.env.RUN_JUDGE_EVAL === '1' && !!process.env.GEMINI_API_KEY;
const TURN_ENABLED = ENABLED && !!process.env.ANTHROPIC_API_KEY;

const NOW = new Date('2026-07-04T00:00:00Z');

// 代表テーマ（固定セット）: (a) 時事の具体的出来事 (b) 領土/歴史認識 (c) 宗教/教義 (d) 陰謀論
const THEMES = {
	current: '2026年の日本の物価高と賃上げ',
	territory: '北方領土の帰属をめぐる日本とロシアの対立',
	religion: '進化論と創造論をめぐる論争',
	conspiracy: '新型コロナワクチンにマイクロチップが入っているという主張'
} as const;

const judgeSchema = z.object({ pass: z.boolean(), reason: z.string() });

// 単一シグナルの LLM-judge。pass/false と理由を返す。
const judge = async (
	criterion: string,
	target: string
): Promise<{ pass: boolean; reason: string }> => {
	const result = await generateObject({
		model: getPipelineModel('factCheckJudge'),
		schema: judgeSchema,
		messages: [
			{
				role: 'user',
				content: `あなたは厳密な評価者です。次の合格基準を満たすか判定してください。\n\n【合格基準】\n${criterion}\n\n【評価対象】\n${target}\n\n基準を満たすなら pass=true、満たさないなら pass=false とし、reason に根拠を簡潔に書いてください。`
			}
		]
	});
	return result.object;
};

const factsToText = (factBase: FactBase): string =>
	factBase.facts.length === 0
		? '（事実なし）'
		: factBase.facts
				.map((f, i) => {
					const src = f.sources.map((s) => s.title || s.url).join(', ');
					return `${i + 1}. ${f.statement}${src ? `（出典: ${src}）` : '（出典なし）'}`;
				})
				.join('\n');

const makePersona = (over: Partial<Persona>): Persona => ({
	id: 'eval-p1',
	topicId: 'eval-topic',
	name: '評価用ペルソナ',
	age: 45,
	occupation: '会社員',
	stakeholderRole: '一般市民',
	role: '一般市民',
	background: '',
	interests: '',
	nationality: '日本',
	engagementLevel: 'moderate',
	selected: true,
	sortOrder: 0,
	...over
});

// --- 事実リサーチ: 具体性・網羅性・帰属形中立性（R1, R2, R7） ---
describe.skipIf(!ENABLED)('事実リサーチの挙動（fact-research-agent）', () => {
	// テーマごとに一度だけ grounding を叩き、複数シグナルを判定する
	const themeEntries = Object.entries(THEMES) as Array<[keyof typeof THEMES, string]>;

	it.each(themeEntries)(
		'%s: 具体性（数値・固有名詞・日付・経緯が一般論に薄まらない）',
		async (_key, title) => {
			const result = await runFactResearch(title, NOW);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			if (result.value.facts.length === 0) {
				console.info(`[eval] ${title}: 事実0件（grounding空縮退）→ 具体性判定スキップ`);
				return;
			}
			const text = factsToText(result.value);
			const verdict = await judge(
				'各事実が一般論・抽象的評価に薄まらず、確認できる範囲で出来事・結果・数値・固有名詞・日付・経緯などの具体的要素を含んでいる。',
				text
			);
			console.info(`[eval] 具体性 ${title} → ${verdict.pass} : ${verdict.reason}`);
			expect(verdict.pass).toBe(true);
		},
		180_000
	);

	it.each(themeEntries)(
		'%s: 網羅性（主要側面を複数事実で被覆し恣意的に少数化していない）',
		async (_key, title) => {
			const result = await runFactResearch(title, NOW);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			if (result.value.facts.length === 0) {
				console.info(`[eval] ${title}: 事実0件 → 網羅性判定スキップ`);
				return;
			}
			const verdict = await judge(
				'テーマの主要な出来事・論点・関係主体が複数の事実で網羅されており、単一の側面に偏っていない。',
				factsToText(result.value)
			);
			console.info(`[eval] 網羅性 ${title} → ${verdict.pass} : ${verdict.reason}`);
			expect(verdict.pass).toBe(true);
		},
		180_000
	);

	// 帰属形の中立性は立場が分かれるテーマ（領土・宗教・陰謀論）で判定する
	const disputedEntries = themeEntries.filter(([k]) => k !== 'current');
	it.each(disputedEntries)(
		'%s: 帰属形の中立性（誰が主張／実効支配／コンセンサスによれば。裸の断定・「係争中」等の評価的特徴づけがない）',
		async (_key, title) => {
			const result = await runFactResearch(title, NOW);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			if (result.value.facts.length === 0) {
				console.info(`[eval] ${title}: 事実0件 → 帰属形判定スキップ`);
				return;
			}
			const verdict = await judge(
				'立場によって認識が分かれる争点が、裸の断定ではなく帰属・観測可能な形（誰が何を主張／実効支配しているか、文書化された出来事・日付、「科学的コンセンサスによれば〜」）で書かれている。「係争中」「未解決」等の評価的ラベルだけで済ませたり、どちらが正しいかを裁定したりしていない。確立した事実は一部の立場が否定していても帰属形で保持されている。',
				factsToText(result.value)
			);
			console.info(`[eval] 帰属形中立 ${title} → ${verdict.pass} : ${verdict.reason}`);
			expect(verdict.pass).toBe(true);
		},
		180_000
	);
});

// --- 取材: 人物像の非戯画化(A) と 立場の非平板化(B)（R8.1-8.3, R6） ---
describe.skipIf(!ENABLED)('取材の挙動（interview-agent）', () => {
	const cases: Array<{ label: string; theme: string; persona: Partial<Persona>; fact: string }> = [
		{
			label: '宗教/教義（創造論を信じる立場）',
			theme: THEMES.religion,
			persona: {
				name: 'デイビッド',
				age: 52,
				occupation: '牧師',
				stakeholderRole: '宗教指導者',
				role: '福音派の牧師',
				background: '聖書を字義通りに解釈する福音派教会で育ち、現在は地域教会を率いる',
				interests: '聖書解釈、信仰教育'
			},
			fact: '科学的コンセンサスは、地球上の生物種が自然選択を通じて共通祖先から進化したとする'
		},
		{
			label: '陰謀論（ワクチン懐疑の立場）',
			theme: THEMES.conspiracy,
			persona: {
				name: '佐藤',
				age: 38,
				occupation: '自営業',
				stakeholderRole: 'ワクチン懐疑派',
				role: 'ワクチン接種に強い不信を持つ市民',
				background: 'SNSで反ワクチン情報に多く触れ、行政や製薬会社への不信が強い',
				interests: '健康、代替医療'
			},
			fact: '各国の保健当局と査読論文は、新型コロナワクチンにマイクロチップは含まれていないとする'
		}
	];

	it.each(cases)(
		'$label: 人物像が紋切り型でなく背景・理由を伴う立体像である（A維持）',
		async ({ theme, persona, fact }) => {
			const context: TopicContext = {
				factBase: { facts: [{ statement: fact, sources: [] }], generatedAt: NOW }
			};
			const result = await runInterview(theme, makePersona(persona), context);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const verdict = await judge(
				'この信念ドキュメントの人物像は、単純なステレオタイプ（紋切り型・戯画）ではなく、その認識に至った背景・根拠・葛藤を伴う立体的な人物として描かれている。',
				result.value.belief
			);
			console.info(`[eval] 非戯画化(A) ${persona.name} → ${verdict.pass} : ${verdict.reason}`);
			expect(verdict.pass).toBe(true);
		},
		240_000
	);

	it.each(cases)(
		'$label: 立場の事実認識が consensus へ矯正されず層②として帰属保持されている（B層②）',
		async ({ theme, persona, fact }) => {
			const context: TopicContext = {
				factBase: { facts: [{ statement: fact, sources: [] }], generatedAt: NOW }
			};
			const result = await runInterview(theme, makePersona(persona), context);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			const verdict = await judge(
				'この信念ドキュメントは、この立場から見た事実認識（層②）を、共通見解（consensus）へ均して打ち消すのではなく、この人物に帰属する認識として保持している。「立場から見た事実」に相当する内容が、当人の視点として（consensusへの全面降伏ではなく）描かれている。',
				result.value.belief
			);
			console.info(`[eval] 非平板化(B) ${persona.name} → ${verdict.pass} : ${verdict.reason}`);
			expect(verdict.pass).toBe(true);
		},
		240_000
	);
});

// --- 討論: 層②優先の安定（衝突点で優先しつつ全否認しない）（R8.8, R8.9） ---
describe.skipIf(!TURN_ENABLED)('討論ターンの層②優先（persona-agent）', () => {
	const chapter: Chapter = { id: 'ch1', title: '生命の起源をどう考えるか', agenda: [] };
	const factBase: FactBase = {
		facts: [
			{
				statement: '科学的コンセンサスによれば、地球は約46億年前に形成されたとされる',
				sources: []
			},
			{ statement: '国連は2015年に持続可能な開発目標(SDGs)を採択した', sources: [] }
		],
		generatedAt: NOW
	};
	// 層②が factBase の1点目と衝突する信念（若い地球説）。2点目とは衝突しない。
	const beliefContent = `## 立場と根拠
私は聖書の記述を字義通りに信じており、世界は比較的最近に創造されたと考えています。

## 前提としている事実（立場から見た事実）
地球や生命は数千年前に神によって創造されたものであり、数十億年という年代測定は前提が誤っていると理解しています。`;

	const persona = makePersona({
		name: 'デイビッド',
		occupation: '牧師',
		role: '福音派の牧師',
		beliefs: [
			{
				id: 'b1',
				version: 1,
				content: beliefContent,
				createdAt: NOW as unknown as import('firebase-admin/firestore').Timestamp
			}
		]
	});

	const engagement: Engagement = {
		personaId: persona.id,
		score: 4,
		mode: 'opinion',
		intentSummary: '地球の年代について自分の考えを述べたい'
	};

	it('衝突点（地球の年代）では層②を優先しつつ、無関係な事実（SDGs）まで否認しない', async () => {
		const result = await generateTurn(persona, { chapterTurns: [], chapter, factBase }, engagement);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const verdict = await judge(
			'この発言は、自分の認識と食い違う点（地球の年代）については自分の見方を優先して述べているが、共通前提として提示された事実すべてを一律に否認してはいない（特に自分の信念と無関係な事実まで否定していない）。',
			result.value.content
		);
		console.info(
			`[eval] 層②優先の安定 → ${verdict.pass} : ${verdict.reason} / 発言: ${result.value.content}`
		);
		expect(verdict.pass).toBe(true);
	}, 180_000);
});
