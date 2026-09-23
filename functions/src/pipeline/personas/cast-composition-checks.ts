// キャスト構成の機械判定。生成物だけを入力に取る純関数として置き、検証ハーネス
// （verify-cast-composition.ts）が LLM を呼んで得た結果をここへ渡す。判定の規則そのものは
// LLM を呼ばずに単体テストで確かめられる。
//
// 判定対象は LLM の出力に由来する項目だけに限る。立場からペルソナへの所在の引き継ぎは
// コードが確定させる値なので検査しない（自分が焼き込んだ値を読み返すだけになる）。
import { REGIONAL_SURNAMES } from '../../constants/japanese-surnames.js';
import { SURNAME_REGION_OF_PREFECTURE } from '../../constants/surname-regions.js';

/** 判定に必要な範囲だけを受ける（GeneratedPersona / 永続形のどちらからでも渡せる） */
export type CheckedPersona = {
	name: string;
	prefecture?: string;
};

/** 機械判定の結果。実施件数を必ず持ち、0件（該当なし）と未実施を読み手が区別できるようにする。 */
export type Check = {
	name: string;
	checked: number;
	failures: string[];
	/** 失敗ではないが読み手に見せる事実（比率どおりの揺れなど） */
	notes: string[];
};

const JAPANESE_NAME_SEPARATOR = ' ';
const FOREIGN_NAME_SEPARATOR = '・';
const KATAKANA_ONLY = /^[゠-ヿㇰ-ㇿー]+$/;

export const runCastCompositionChecks = (personas: CheckedPersona[]): Check[] => [
	checkRegionalSurname(personas),
	checkJapaneseSurnameLeftEmpty(personas),
	checkNameFormat(personas)
];

/**
 * 都道府県を持つ人物に、その地域の姓が引かれているか。
 * 地域色の強い県に暮らす人物だけが対象で、その人物が出るかはテーマ次第である（0件は異常ではない）。
 * 地域姓は REGIONAL_RATIO の比率でしか引かないため、外れた件数は失敗ではなく事実として出す。
 */
export const checkRegionalSurname = (personas: CheckedPersona[]): Check => {
	const targets = personas.filter(
		(persona) => persona.prefecture && SURNAME_REGION_OF_PREFECTURE[persona.prefecture]
	);
	const notes = targets.map((persona) => {
		const region = SURNAME_REGION_OF_PREFECTURE[persona.prefecture!];
		const surname = persona.name.split(JAPANESE_NAME_SEPARATOR)[0];
		const inRegion = REGIONAL_SURNAMES[region].some(([candidate]) => candidate === surname);
		const verdict = inRegion ? 'その地域の姓' : '全国の姓（比率どおりで異常ではない）';
		return `${inRegion ? '○' : '−'} ${persona.name}（${persona.prefecture}・${region}）… ${verdict}`;
	});
	return { name: '地域色の強い県に暮らす人物の姓', checked: targets.length, failures: [], notes };
};

/**
 * 日本語の姓名の人物が familyName を空で返しているか。
 * 空で返していればコードが姓を割り当て「姓 名」になる。姓を返すと「名・姓」になるため、
 * 中黒表記なのに姓名が漢字・ひらがなであれば、姓の決定が LLM に戻っている。
 */
export const checkJapaneseSurnameLeftEmpty = (personas: CheckedPersona[]): Check => {
	const targets = personas.filter((persona) => persona.name.includes(FOREIGN_NAME_SEPARATOR));
	const failures = targets
		.filter((persona) =>
			persona.name
				.split(FOREIGN_NAME_SEPARATOR)
				.every((part) => part.length > 0 && !KATAKANA_ONLY.test(part))
		)
		.map(
			(persona) =>
				`${persona.name}: 日本語の姓名なのに familyName を返している（姓の決定が LLM に戻っている）`
		);
	return {
		name: '姓を返した人物の氏名がカタカナ表記であること',
		checked: targets.length,
		failures,
		notes: []
	};
};

/** 表示名が「姓 名」（コードが姓を割り当て）か「名・姓」（LLM が姓名を返した）のいずれかであること。 */
export const checkNameFormat = (personas: CheckedPersona[]): Check => {
	const failures = personas
		.filter((persona) => {
			const name = persona.name.trim();
			if (name.includes(FOREIGN_NAME_SEPARATOR)) {
				return name.split(FOREIGN_NAME_SEPARATOR).some((part) => part.length === 0);
			}
			return name.split(JAPANESE_NAME_SEPARATOR).filter((part) => part.length > 0).length !== 2;
		})
		.map((persona) => `${persona.name}: 「姓 名」「名・姓」のいずれの形にもなっていない`);
	return { name: '表示名の形式', checked: personas.length, failures, notes: [] };
};
