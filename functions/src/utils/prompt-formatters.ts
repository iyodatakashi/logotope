import type { DebateTurn } from '../types/turn.types.js';
import type { Persona } from '../types/persona.types.js';
import type { FactBase } from '../types/topic.types.js';

// 事実基盤を「確定した客観的事実（共通前提）」としてプロンプトに整形する。
// 事実が無い（factBase 未設定・facts 空）なら空文字を返し、消費者は従来どおり動作する。
// 参考資料（sourceContents）とは区別し、全消費者で同一の共通前提として提示する（R9.3）。
export const formatFactBaseSection = (factBase?: FactBase): string => {
	if (!factBase?.facts.length) return '';
	const facts = factBase.facts
		.map((fact, i) => {
			const sources = fact.sources.length
				? `（出典: ${fact.sources.map((s) => s.title || s.url).join(', ')}）`
				: '';
			return `${i + 1}. ${fact.statement}${sources}`;
		})
		.join('\n');
	return `\n\n【確定した客観的事実（共通前提）】\nこのテーマについて確認された客観的事実です。参考資料とは別に、全員が共有する確定した前提として扱ってください。\n${facts}`;
};

export const currentDateString = (): string => {
	const d = new Date();
	return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

export const formatPersonas = (personas: Persona[]): string => {
	return personas
		.map((p) => `- ID: ${p.id}, 名前: ${p.name}, 立場: ${p.specificRole || p.stakeholderRole}`)
		.join('\n');
};

export const formatTurns = (
	turns: ReadonlyArray<DebateTurn>,
	personas: ReadonlyArray<Persona>
): string => {
	return turns
		.map((t) => {
			if (t.personaId) {
				const persona = personas.find((p) => p.id === t.personaId);
				const name = persona ? persona.name : `Persona(${t.personaId})`;
				const role = persona ? persona.specificRole || persona.stakeholderRole : '';
				return `[${name}(${role})(ID:${t.personaId})]: ${t.content}`;
			}
			return `[ファシリテーター()]: ${t.content}`;
		})
		.join('\n');
};
