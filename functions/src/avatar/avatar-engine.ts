// 唯一の生成実装（共有エンジン）。本番生成経路（runAvatarCore）と offline 検証の双方がこれだけを
// 呼ぶことで、検証コードと本番コードの乖離を構造的に不能にする（Req 1.4）。
//
// 入力（personaId・attempt・age・genderPresentation・occupation）から
//   seed 選択 → 可変軸導出 → プロンプト → モデル呼び出し → 後処理
// を束ね、256 透過 PNG を返す。**gender（性自認）は入力に含めない**（Req 3.7）。
// Firestore/Storage には触れない純粋生成。適合 seed 無し（androgynous）と生成失敗は
// throw せず戻り値で判別する（本番は失敗を握りつぶして討論生成を止めない）。

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PersonaGenderPresentation } from '../types/persona.types.js';
import { toGeneration, selectSeed, isSeedPresentation } from './avatar-seeds.js';
import { resolveVariation } from './avatar-variation.js';
import { buildAvatarPrompt } from './avatar-prompt.js';
import { generateImage } from './avatar-image-client.js';
import { toAsset } from './avatar-postprocess.js';

export interface AvatarSpec {
	/** 決定的選択の同一性キー。 */
	personaId: string;
	/** 初回=0（決定的）。再生成で変えると別 seed／軸を引く（探索）。 */
	attempt: number;
	age: number;
	/** 外観のみ。gender（性自認）は渡さない。 */
	genderPresentation: PersonaGenderPresentation;
	occupation: string;
}

export type GenerateResult =
	| { ok: true; asset: Uint8Array } // 256x256 RGBA 黒+アルファ PNG
	| { ok: false; reason: 'no_seed' | 'generation_failed' };

// seeds/ はこのモジュールと同じ場所に配置する（本番は lib/avatar/seeds/、テストは src/avatar/seeds/）。
// seed は不透明 RGB（黒シルエット＋白背景）なので、そのまま編集元として渡す。
const readSeed = (fileName: string): Promise<Buffer> =>
	readFile(join(__dirname, 'seeds', fileName));

export const generateAvatarAsset = async (spec: AvatarSpec): Promise<GenerateResult> => {
	const generation = toGeneration(spec.age);
	const presentation = spec.genderPresentation;

	// 適合 seed の無い外見表現（androgynous）は生成せず「seed 無し」を返す。
	if (!isSeedPresentation(presentation)) return { ok: false, reason: 'no_seed' };
	const seed = selectSeed(spec.personaId, spec.attempt, generation, presentation);
	if (!seed) return { ok: false, reason: 'no_seed' };

	try {
		const variation = resolveVariation(spec.personaId, spec.attempt, generation, presentation);
		const prompt = buildAvatarPrompt({ ...variation, age: spec.age, occupation: spec.occupation });
		const seedBytes = await readSeed(seed.fileName);
		const raw = await generateImage(prompt, seedBytes);
		const asset = await toAsset(raw);
		return { ok: true, asset };
	} catch {
		// 一時失敗の使い切り・画像未返却・後処理失敗はすべて「生成失敗」に畳む（throw しない）。
		return { ok: false, reason: 'generation_failed' };
	}
};
