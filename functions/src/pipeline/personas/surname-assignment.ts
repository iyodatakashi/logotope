import { NATIONAL_SURNAMES, REGIONAL_SURNAMES } from '../../constants/japanese-surnames.js';
import { REGIONAL_RATIO, SURNAME_REGION_OF_PREFECTURE } from '../../constants/surname-regions.js';

type Candidates = ReadonlyArray<readonly [string, number]>;

/**
 * 居住地に応じた姓を、キャスト全体で重複しないように割り当てる（配色の assignAll と同じ「生成時に
 * 1回だけ確定させる」層）。姓の決定を LLM から取り上げ、語彙と分布をコード側で持つのがこの関数の目的。
 *
 * prefectures の各要素は日本人ペルソナの居住都道府県。日本人でないペルソナは null を渡し、
 * その位置には空文字を返す（姓を割り当てない）。
 *
 * 地域色の強い県では REGIONAL_RATIO の比率で地域の姓を引く。全員を地域の姓にしないのは、
 * 実際にその土地には他所から移り住んだ人もいるため。
 */
export const assignSurnames = (
	prefectures: Array<string | null>,
	random: () => number = Math.random
): string[] => {
	const used = new Set<string>();

	const draw = (candidates: Candidates): string | null => {
		const available = candidates.filter(([surname]) => !used.has(surname));
		const total = available.reduce((sum, [, weight]) => sum + weight, 0);
		if (total === 0) return null;
		// 重み付き抽選。多い姓ほど出やすいが、重みは人口を平方根で均してあるので上位に張り付かない。
		let threshold = random() * total;
		for (const [surname, weight] of available) {
			threshold -= weight;
			if (threshold < 0) {
				used.add(surname);
				return surname;
			}
		}
		const [surname] = available[available.length - 1];
		used.add(surname);
		return surname;
	};

	return prefectures.map((prefecture) => {
		if (prefecture === null) return '';
		const region = SURNAME_REGION_OF_PREFECTURE[prefecture];
		const useRegional = region !== undefined && random() < REGIONAL_RATIO[region];
		// 地域リストを引き当てられなかった場合（使い切り含む）は全国リストへ落とす
		const fromRegion = useRegional ? draw(REGIONAL_SURNAMES[region]) : null;
		return fromRegion ?? draw(NATIONAL_SURNAMES) ?? '';
	});
};
