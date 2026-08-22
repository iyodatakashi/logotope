import { generateObject } from 'ai';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { getPipelineModel } from '../llm/models.js';
import { formatFactBaseSection } from '../utils/prompt-formatters.js';
import { assignSurnames } from '../pipeline/personas/surname-assignment.js';
import { normalizePrefecture } from '../constants/surname-regions.js';
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

export const personasSchema = (count: number) =>
	z.object({
		personas: z
			.array(
				z.object({
					sourceTag: z.string(),
					stakeholderRole: z.string(),
					// 具体的立場（旧 specificRole）。空文字は弾く（非空保証を生成入口で担保する）。
					role: z.string().min(1),
					// 姓名は分けて受け取り、表示名 name はコード側で組み立てる。日本人ペルソナの
					// familyName は空で返させ、居住地に応じた姓をコード側で割り当てる。
					familyName: z.string(),
					givenName: z.string().min(1),
					// 日本人ペルソナの居住都道府県（正式表記）。外国人ペルソナは空文字。
					homePrefecture: z.string(),
					nationality: z.string(),
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

/**
 * 表示名を組み立てる。日本人ペルソナは割り当てた姓と名を半角スペースで繋ぎ、外国人ペルソナは
 * LLM が返したカタカナの姓名を「名・姓」の順に中黒で繋ぐ（例: ルイス・ハミルトン）。
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
		const engagementLabel = (level?: string) =>
			level === 'high' ? '専門・意識:高' : level === 'low' ? '専門・意識:低' : '専門・意識:中';
		const rolesDesc = stakeholders
			.map(
				(stakeholder, i) =>
					`${sourceTagForIndex(i)}: ${stakeholder.role}（${engagementLabel(stakeholder.engagementLevel)}）`
			)
			.join('\n');
		const factSection = formatFactBaseSection(topicContext?.factBase);

		try {
			const result = await generateObject({
				model: getPipelineModel('personaGenerator'),
				schema: personasSchema(stakeholders.length),
				messages: [
					{
						role: 'user',
						content: `テーマ「${title}」について、以下の各立場を代表するペルソナを1体ずつ生成してください。\n\n【居住地と名前】\n- 基本的には日本人のペルソナとして生成すること。ただしテーマが明らかに海外を舞台とする（例: F1、海外スポーツ、国際政治）場合は、そのテーマに合った国籍の人物を含めること\n- homePrefecture … 日本人ペルソナが暮らす都道府県を正式表記（例: 沖縄県・大阪府・東京都・北海道）で設定する。その人物の立場・職業・背景と噛み合う土地を選ぶこと。特定の地域を代表する立場（例: 沖縄県民、被災地の住民）では必ずその土地にすること。外国人ペルソナは空文字にする\n- familyName … 日本人ペルソナでは空文字にすること。姓は居住地に合わせてシステム側が割り当てるので、考える必要はない\n- givenName … 日本人ペルソナの名（姓を除いた部分）。その人物の年代（昭和・平成・令和で命名の傾向が違う）と性別に合ったものにすること\n- 外国人ペルソナは familyName・givenName の両方を、その国籍の実際の名前の傾向に沿ったカタカナで設定すること（例: givenName「ルイス」/ familyName「ハミルトン」）。homePrefecture は空文字\n- 年齢層・職業・社会的背景の多様性を確保すること\n\n立場リスト:\n${rolesDesc}${factSection}\n\n各ペルソナは「実在する一人の人物」として設定してください。職業は具体的な職種・役職まで落とし込み、背景には家族構成・居住地・年収・趣味など生活の具体的なディテールを盛り込んでください。\n\n【立場の具体化（重要）】\n各ペルソナには複数の属性がある。混同しないこと。\n- sourceTag … 由来する立場を示すタグ。立場リストの各行頭のタグ（例: S1）を、その立場から生成したペルソナに一字一句そのまま転記する。出力の並び順は問わないが、由来する立場のタグを必ず正確に返すこと。\n- stakeholderRole … 対応するステークホルダーの総称。立場リストの総称をそのまま引き継ぐ（例: F1チーム関係者）。\n- role … このテーマにおける「具体的な立場・肩書き」。**必ず具体的な立場を入れ、空文字で返さない**（総称のまま・空欄は不可）。「F1チーム関係者」のような総称は、オーナー／レースエンジニア／メカニックなど具体的な役職に必ず特定する。「F1の熱心なファン」のように総称が既に具体的なら、それを反映する。\n- occupation … 実生活上の職業。テーマに職業として関わる人物では role と一致するが、「F1の熱心なファン」のように職業外で関わる人物では、occupation がテーマと無関係（例: 市役所職員）でよい。その場合でもその人物のテーマ上の立場（role）は「F1の熱心なファン」である。職業を立場と取り違えないこと。\n\n【専門・意識レベルに応じた描き分け（重要）】\n人物の「テーマに対する専門知識・意識の高さ」を、立場リストの専門・意識レベルに必ず合わせてください。全員を持論の強い専門家・当事者にしないこと。ただし、どのレベルの人物も議論には主体的に参加し、自分なりの意見を持っています。無関心・他人事の傍観者は作らないでください。\n- 専門・意識:高 → テーマを深く考え、明確な持論・専門的な視点を持つ人物として描く\n- 専門・意識:中 → 専門家ではないが一定の知識と関心を持ち、生活実感に基づく等身大の意見を持つ人物として描く\n- 専門・意識:低 → 専門知識は乏しく難しい用語は使わない人物。生活者・当事者の目線から、生活実感に根ざした素朴な意見・疑問・要望を自分なりに持つ。interests は専門用語を避け、この人物の生活に根ざした具体的な関心事として記述すること\n\nengagementLevel には、対応するステークホルダーの専門・意識レベルをそのまま設定してください。\n\n【性のあり方（2軸）】\n性のあり方は「その人が誰か」と「どう見えるか」の2つに分けて設定する。\n- gender … 性自認。male / female / non-binary から選ぶ。討論での発言・信念・背景に効く。\n- genderPresentation … 外見表現。masculine / feminine / neutral から選ぶ。アバターの見た目に使う。\n\n両者は原則として一致させること（female なら feminine）。乖離させるのは、その人物の背景がそれを必要とする場合（例: 性自認は女性だが男性の格好をしている）に限る。トランスジェンダーを別の値にはしない（トランス女性は gender: female）。「トランスであること」は性自認ではなく経験・来歴なので、討論上意味がある場合にのみ background に自然文で記すこと。性的指向はどちらの軸にも含めない。`
					}
				]
			});

			// 日本人ペルソナかどうかは homePrefecture が都道府県として読めるかで判定する
			// （nationality の表記ゆれに依らない）。姓は LLM の出力を使わず、居住地に応じて割り当てる。
			const homePrefectures = result.object.personas.map((persona) =>
				normalizePrefecture(persona.homePrefecture)
			);
			// 居住地が読めなくても familyName が空なら日本人（プロンプトが空を指示している）。
			// 地域は分からないので全国の姓を引く。これが無いと姓の無い「美和・」のような名前になる。
			const needsSurname = result.object.personas.map(
				(persona, i) => homePrefectures[i] !== null || persona.familyName.trim() === ''
			);
			// 空文字は「日本人だが地域が不明」の意味で、全国の姓が引かれる（null は姓を付けない）。
			const surnames = assignSurnames(
				homePrefectures.map((prefecture, i) => (needsSurname[i] ? (prefecture ?? '') : null))
			);

			// familyName / givenName は表示名 name を組み立てるための入力であって永続しない。
			const personas: GeneratedPersona[] = result.object.personas.map(
				({ familyName, givenName, ...rest }, i) => ({
					...rest,
					homePrefecture: homePrefectures[i] ?? '',
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
