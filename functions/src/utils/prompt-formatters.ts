import dayjs from 'dayjs';
import type { DebateTurn } from '../types/turn.types.js';
import type { Persona, AwarenessForFirestore } from '../types/persona.types.js';
import type { FactBase } from '../types/factBase.types.js';
import type { TopicContext } from '../types/topic.types.js';

/** 日付を「YYYY年M月D日」形式に整形する（時事プロンプト・grounding 基準日の共通整形） */
export const formatJapaneseDate = (date: Date): string => dayjs(date).format('YYYY年M月D日');

// テーマの共通前提（詳細説明・参考資料・確定した事実）をプロンプトの節へ整形する唯一の関数。
// 全生成段がこれを呼び、同じ入力からは常に同じ文字列を返す。呼び出し側で重みを切り替える引数は
// 持たない（持てば「段ごとに供給内容を取捨する分岐」が戻る）。
// 本文に工程固有の語（論点・章立て等）を入れない。どの工程に載せても文脈が合う一般形にする。
// 参考資料は切り詰めない。上限は取り込み時（source-fetcher）で既に決まっており、
// プロンプト側の二重の上限は誰も決めていない段ごとの差を生む。
export const formatTopicContextSection = (topicContext?: TopicContext): string => {
	if (!topicContext) return '';
	const parts: string[] = [];
	if (topicContext.description) {
		parts.push(
			`\n\n【テーマの方向性（最優先）】\n以下はこのテーマで設定者が意図した方向性・重視する観点です。必ずこの方向性に沿って生成し、方向性から外れた切り口は避けてください。\n${topicContext.description}`
		);
	}
	if (topicContext.sourceContents?.length) {
		const sources = topicContext.sourceContents
			.map((sourceContent, i) => `--- 参考資料 ${i + 1} ---\n${sourceContent}`)
			.join('\n\n');
		parts.push(`\n\n【参考資料】\n${sources}`);
	}
	parts.push(formatFactBaseSection(topicContext.factBase));
	return parts.join('');
};

// 事実基盤を「確定した客観的事実（共通前提）」としてプロンプトに整形する。
// 事実が無い（factBase 未設定・facts 空）なら空文字を返し、消費者は従来どおり動作する。
// 参考資料（sourceContents）とは区別し、全消費者で同一の共通前提として提示する（R9.3）。
export const formatFactBaseSection = (factBase?: FactBase): string => {
	if (!factBase?.facts.length) return '';
	const facts = factBase.facts
		.map((fact, i) => {
			const sources = fact.sources.length
				? `（出典: ${fact.sources.map((source) => source.title || source.url).join(', ')}）`
				: '';
			return `${i + 1}. ${fact.statement}${sources}`;
		})
		.join('\n');
	return `\n\n【確定した客観的事実（共通前提）】\nこのテーマについて確認された客観的事実です。参考資料とは別に、全員が共有する確定した前提として扱ってください。\n${facts}`;
};

// 蓄積された気づき（awareness）を揮発部（user）へ差し込むための整形。
// 気づきが無ければ空文字を返し、消費者は従来どおり動作する。
// 信念は不変の主軸であり、気づきは立場を反転させない範囲で発言に反映する文脈として提示する。
export const formatAwarenessSection = (
	awarenesses?: ReadonlyArray<AwarenessForFirestore>
): string => {
	if (!awarenesses?.length) return '';
	const lines = awarenesses
		.map(
			(awareness) =>
				`- （${awareness.kind === 'reception' ? '受容' : '自分の気づき'}）${awareness.content}`
		)
		.join('\n');
	return `\n\n【討論中に得た気づき】\nこれまでの傾聴で、他者の視点に「一理ある」と受け止めた点や、自分の中で生じた気づきです。あなたの信念（不変の主軸）は変えず、立場を反転させない範囲でこれらを踏まえて発言してください。\n${lines}`;
};

export const currentDateString = (): string => formatJapaneseDate(new Date());

export const formatPersonas = (personas: Persona[]): string => {
	return personas
		.map((persona) => `- ID: ${persona.id}, 名前: ${persona.name}, 立場: ${persona.role}`)
		.join('\n');
};

/**
 * `includePersonaIds`: 各行に `(ID:...)` を付けるか。既定は付ける（発言生成が targetPersonaId を返すため）。
 * ペルソナ ID を出力しない呼び出し（意欲評価）は false にする。1行あたり26字を毎回送らずに済むうえ、
 * 気づきの `sourceTurnId` に序数ではなく ID を書かせてしまう紛れも防げる。
 */
export const formatTurns = (
	turns: ReadonlyArray<DebateTurn>,
	personas: ReadonlyArray<Persona>,
	{ includePersonaIds = true }: { includePersonaIds?: boolean } = {}
): string => {
	return turns
		.map((turn) => {
			if (turn.personaId) {
				const persona = personas.find((candidate) => candidate.id === turn.personaId);
				const name = persona ? persona.name : `Persona(${turn.personaId})`;
				const role = persona ? persona.role : '';
				const idNote = includePersonaIds ? `(ID:${turn.personaId})` : '';
				return `[${name}(${role})${idNote}]: ${turn.content}`;
			}
			return `[ファシリテーター()]: ${turn.content}`;
		})
		.join('\n');
};
