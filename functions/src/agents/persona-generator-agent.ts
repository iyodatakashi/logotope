import { generateObject } from 'ai';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getPipelineModel } from '../llm/models.js';
import { formatTopicContextSection } from '../utils/prompt-formatters.js';
import { assignSurnames } from '../pipeline/personas/surname-assignment.js';
import { PREFECTURES } from '../constants/surname-regions.js';
import type { Stakeholder } from '../types/stakeholder.types.js';
import type { Persona } from '../types/persona.types.js';
import type { TopicContext } from '../types/topic.types.js';
import type { Result, PipelineError } from '../types/common.types.js';
import { llmTask } from '../llm/usage-recorder.js';

// 由来突合用のエコー用タグ。渡した立場の配列位置から決定的に導出する。
// 生成側がタグをそのまま返すことで、LLM の出力順に依存せず由来を解決できる。
export const sourceTagForIndex = (index: number): string => `S${index + 1}`;

// エコー用タグ（sourceTag）を含む生成ペルソナ。由来 stakeholderId は永続時に personas.ts が付与するため、
// この生成段階ではまだ持たない。sourceTag は由来解決用の一時項目で永続しない。
export type GeneratedPersona = Omit<Persona, 'stakeholderId' | 'colorKey'> & {
	sourceTag: string;
};

/**
 * 生成結果のエコー用タグから由来の立場を解決する（出力順非依存）。
 * タグ欠落/不正時は、出力位置（k 番目）と役割名照合でフォールバックする。
 * 所在の引き継ぎ（この工程）と stakeholderId の確定（persona-chain）で同じ規則を使う。
 */
export const resolveSourceStakeholder = (
	persona: { sourceTag: string; stakeholderRole: string },
	outputIndex: number,
	stakeholders: Stakeholder[]
): Stakeholder => {
	const byTag = stakeholders.find((_, i) => sourceTagForIndex(i) === persona.sourceTag);
	if (byTag) return byTag;
	const byPosition = stakeholders[outputIndex];
	if (byPosition) return byPosition;
	const byRole = stakeholders.find((stakeholder) => stakeholder.role === persona.stakeholderRole);
	return byRole ?? stakeholders[0];
};

export const personasSchema = (count: number) =>
	z.object({
		personas: z
			.array(
				z.object({
					sourceTag: z.string(),
					stakeholderRole: z.string(),
					// 具体的立場（旧 specificRole）。空文字は弾く（非空保証を生成入口で担保する）。
					role: z.string().min(1),
					// 姓名は分けて受け取り、表示名 name はコード側で組み立てる。日本語の姓名の人物は
					// familyName を空で返させ、都道府県に応じた姓をコード側で割り当てる。
					familyName: z.string(),
					givenName: z.string().min(1),
					// 所在。立場が決めている項目は生成後にコードが立場の値で確定させる。
					// 都道府県は有限集合として受け取るため、表記ゆれを吸収する正規化が要らない。
					country: z.string().optional(),
					prefecture: z.enum(PREFECTURES).optional(),
					age: z.number().int(),
					occupation: z.string(),
					background: z.string(),
					interests: z.string(),
					engagementLevel: z.enum(['high', 'medium', 'low']),
					gender: z.enum(['male', 'female', 'non-binary']),
					genderPresentation: z.enum(['masculine', 'feminine', 'neutral'])
				})
			)
			.length(count)
	});

const LEVEL_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };

/** 立場の全項目を1行に畳んで渡す。渡す項目を絞らない（死蔵を作らない）。 */
const formatStakeholder = (stakeholder: Stakeholder, index: number): string => {
	const location = [stakeholder.country, stakeholder.prefecture].filter(Boolean).join('・');
	const attributes = [
		`当事者性:${LEVEL_LABEL[stakeholder.stakeLevel]}`,
		`少数性:${LEVEL_LABEL[stakeholder.minorityLevel]}`,
		`専門・意識:${LEVEL_LABEL[stakeholder.engagementLevel]}`,
		`所在:${location || '指定なし'}`
	].join(' / ');
	return [
		`${sourceTagForIndex(index)}: ${stakeholder.role}（${attributes}）`,
		`    当事者である理由: ${stakeholder.stakeReason}`,
		`    関心事: ${stakeholder.mainInterests.join('、')}`
	].join('\n');
};

const LOCATION_AND_NAME = `【所在と氏名】
- 所在は立場が決めています。立場の「所在」に書かれた国・都道府県はそのまま引き継ぎ、変えないでください。別の国の相当職へ翻案しない（その国の組織・制度・職務に属する立場は、その国の人物として設定する）。
- 立場の所在が「指定なし」の項目は、その人物を描くうえで必要なときだけ補ってください。テーマが決めていない土地を推測で埋めないこと。所在を持たない人物がいることは正しい状態です。
- prefecture は日本国内で暮らす人物にだけ、47都道府県の正式表記で設定します。
- familyName … 日本語の姓名の人物では空文字にすること。姓は都道府県に合わせてシステム側が割り当てるので、考える必要はありません。
- givenName … 日本語の姓名の人物の名（姓を除いた部分）。その人物の年代（昭和・平成・令和で命名の傾向が違う）と性別に合ったものにすること。
- 日本語以外の氏名の人物は familyName・givenName の両方を、その出自の実際の名前の傾向に沿ったカタカナで設定すること（例: givenName「ルイス」/ familyName「ハミルトン」）。
- 氏名はその人物の出自として自然なものにし、同一キャスト内で表記の形式を一貫させてください。
- 年齢層・職業・社会的背景の多様性を確保すること。`;

const ROLE_SPECIFICATION = `【立場の具体化（重要）】
各ペルソナには複数の属性がある。混同しないこと。
- sourceTag … 由来する立場を示すタグ。立場リストの各行頭のタグ（例: S1）を、その立場から生成したペルソナに一字一句そのまま転記する。出力の並び順は問わないが、由来する立場のタグを必ず正確に返すこと。
- stakeholderRole … 対応するステークホルダーの総称。立場リストの総称をそのまま引き継ぐ（例: F1チーム関係者）。
- role … このテーマにおける「具体的な立場・肩書き」。**必ず具体的な立場を入れ、空文字で返さない**（総称のまま・空欄は不可）。「F1チーム関係者」のような総称は、オーナー／レースエンジニア／メカニックなど具体的な役職に必ず特定する。「F1の熱心なファン」のように総称が既に具体的なら、それを反映する。
- occupation … 実生活上の職業。テーマに職業として関わる人物では role と一致するが、「F1の熱心なファン」のように職業外で関わる人物では、occupation がテーマと無関係（例: 市役所職員）でよい。その場合でもその人物のテーマ上の立場（role）は「F1の熱心なファン」である。職業を立場と取り違えないこと。`;

const ENGAGEMENT_DRAWING = `【専門・意識レベルに応じた描き分け（重要）】
人物の「テーマに対する専門知識・意識の高さ」を、立場リストの専門・意識レベルに必ず合わせてください。全員を持論の強い専門家にしないこと。ただし、どのレベルの人物も議論には主体的に参加し、自分なりの意見を持っています。無関心・他人事の傍観者は作らないでください。
- 専門・意識:高 → テーマを深く考え、明確な持論・専門的な視点を持つ人物として描く
- 専門・意識:中 → 専門家ではないが一定の知識と関心を持ち、生活実感に基づく等身大の意見を持つ人物として描く
- 専門・意識:低 → 専門知識は乏しく難しい用語は使わない人物。生活者の目線から、生活実感に根ざした素朴な意見・疑問・要望を自分なりに持つ。interests は専門用語を避け、この人物の生活に根ざした具体的な関心事として記述すること

engagementLevel には、対応するステークホルダーの専門・意識レベルをそのまま設定してください。
当事者性・少数性は、その人物の切実さ・声の届きにくさとして背景や関心事の描き方に反映してください（出力項目ではありません）。`;

const GENDER = `【性のあり方（2軸）】
性のあり方は「その人が誰か」と「どう見えるか」の2つに分けて設定する。
- gender … 性自認。male / female / non-binary から選ぶ。討論での発言・信念・背景に効く。
- genderPresentation … 外見表現。masculine / feminine / neutral から選ぶ。アバターの見た目に使う。

両者は原則として一致させること（female なら feminine）。乖離させるのは、その人物の背景がそれを必要とする場合（例: 性自認は女性だが男性の格好をしている）に限る。トランスジェンダーを別の値にはしない（トランス女性は gender: female）。「トランスであること」は性自認ではなく経験・来歴なので、討論上意味がある場合にのみ background に自然文で記すこと。性的指向はどちらの軸にも含めない。`;

/**
 * 表示名を組み立てる。コードが姓を割り当てた人物（日本語の姓名）は割り当てた姓と名を半角スペースで
 * 繋ぎ、それ以外は LLM が返したカタカナの姓名を「名・姓」の順に中黒で繋ぐ（例: ルイス・ハミルトン）。
 * 表記の一貫性を日本語の指示ではなくこの関数で担保する。
 */
const composeName = (assignedSurname: string, givenName: string, familyName: string): string =>
	assignedSurname ? `${assignedSurname} ${givenName}` : `${givenName}・${familyName}`;

export const generatePersonas = llmTask(
	'persona-generation',
	async (
		title: string,
		stakeholders: Stakeholder[],
		topicId: string,
		topicContext?: TopicContext
	): Promise<Result<{ personas: GeneratedPersona[] }, PipelineError>> => {
		const rolesDesc = stakeholders.map(formatStakeholder).join('\n');
		const contextSection = formatTopicContextSection(topicContext);

		try {
			const result = await generateObject({
				model: getPipelineModel('personaGenerator'),
				schema: personasSchema(stakeholders.length),
				messages: [
					{
						role: 'user',
						content: `テーマ「${title}」について、以下の各立場を代表するペルソナを1体ずつ生成してください。${contextSection}\n\n立場リスト:\n${rolesDesc}\n\n${LOCATION_AND_NAME}\n\n各ペルソナは架空の一人の人物として設定してください（実在の特定個人を模さないこと）。職業は具体的な職種・役職まで落とし込み、背景には家族構成・住まい・収入・趣味など生活の具体的なディテールを盛り込んでください。生活の細部の具体性は出自によらず同等にすること。\n\n${ROLE_SPECIFICATION}\n\n${ENGAGEMENT_DRAWING}\n\n${GENDER}`
					}
				]
			});

			// 所在は立場が決めた範囲をコードが確定させる。立場が埋めた項目は LLM の出力で上書きしない
			// （プロンプトの指示と併せた二重の担保）。立場が空にした項目だけ生成結果の値を採る。
			const sources = result.object.personas.map((persona, i) =>
				resolveSourceStakeholder(persona, i, stakeholders)
			);
			const countries = result.object.personas.map(
				(persona, i) => sources[i].country ?? persona.country
			);
			const prefectures = result.object.personas.map(
				(persona, i) => sources[i].prefecture ?? persona.prefecture
			);

			// 姓の割り当ては familyName が空のとき（＝日本語の姓名の人物）に走る。都道府県があれば
			// その県の地域姓／全国姓を、無ければ都道府県を限定せず全国の語彙から抽選する。
			// null は姓を付けない（LLM が姓名を返した人物）。
			const surnames = assignSurnames(
				result.object.personas.map((persona, i) =>
					persona.familyName.trim() === '' ? (prefectures[i] ?? '') : null
				)
			);

			// familyName / givenName は表示名 name を組み立てるための入力であって永続しない。
			// 所在は確定させた値で置き直すため、生成結果の country / prefecture はここで外す。
			const personas: GeneratedPersona[] = result.object.personas.map(
				({ familyName, givenName, country: _country, prefecture: _prefecture, ...rest }, i) => ({
					...rest,
					// 未設定はキーを置かないことで表す。Firestore は undefined を値にできず、
					// 明示的に置くと所在を持たない人物が1体いるだけで永続が丸ごと弾かれる。
					...(countries[i] === undefined ? {} : { country: countries[i] }),
					...(prefectures[i] === undefined ? {} : { prefecture: prefectures[i] }),
					name: composeName(surnames[i], givenName, familyName),
					id: nanoid(),
					topicId,
					selected: true,
					sortOrder: i
				})
			);
			return { ok: true, value: { personas } };
		} catch (err) {
			console.error('[generatePersonas] error', err);
			return {
				ok: false,
				error: {
					code: 'AI_API_ERROR',
					message: err instanceof Error ? err.message : String(err),
					retryable: true
				}
			};
		}
	}
);
