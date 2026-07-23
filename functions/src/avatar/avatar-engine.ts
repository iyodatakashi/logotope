// 唯一の生成実装（共有エンジン）。本番生成経路（runAvatarCore）と offline 検証の双方がこれだけを
// 呼ぶことで、検証コードと本番コードの乖離を構造的に不能にする（Req 1.4）。
//
// 入力（age・genderPresentation・occupation）から
//   seed 選択 → 可変軸導出 → プロンプト → モデル呼び出し → 後処理
// を束ね、256 透過 PNG を返す。**gender（性自認）は入力に含めない**（Req 3.7）。
// Firestore/Storage には触れない純粋生成。生成失敗は throw せず戻り値で判別する
// （本番は失敗を握りつぶして討論生成を止めない）。

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PersonaGenderPresentation } from '../types/persona.types.js';
import { toGeneration, selectSeed } from './avatar-seeds.js';
import { resolveVariation } from './avatar-variation.js';
import { buildAvatarPrompt } from './avatar-prompt.js';
import { generateImage } from './avatar-image-client.js';
import { toAsset } from './avatar-postprocess.js';

export interface AvatarSpec {
	age: number;
	/** 外観のみ。gender（性自認）は渡さない。 */
	genderPresentation: PersonaGenderPresentation;
	occupation: string;
	// 服装・雰囲気をペルソナの実態に合わせるための具体プロフィール（顔は描かないので装い等にだけ効く）。
	specificRole: string;
	nationality: string;
	background: string;
	interests: string;
}

export type GenerateResult =
	| { ok: true; asset: Uint8Array } // 256x256 RGBA 黒+アルファ PNG
	| { ok: false; reason: 'generation_failed' };

// seeds/ は functions 直下（ビルド生成物の外）に置く確定アセット。src/lib のミラー外なので、
// __dirname から2つ上（src/avatar → functions／lib/avatar → functions）で同じ functions/seeds を指し、
// テストと本番の双方で同一パスが通る（lib へコピーしない）。seed は不透明 RGB でそのまま編集元に渡す。
const readSeed = (fileName: string): Promise<Buffer> =>
	readFile(join(__dirname, '..', '..', 'seeds', fileName));

export const generateAvatarAsset = async (spec: AvatarSpec): Promise<GenerateResult> => {
	const generation = toGeneration(spec.age);
	const presentation = spec.genderPresentation;

	// 全外見表現に seed があるため必ず1枚引ける（selectSeed が世代を seed の世代へ写して選ぶ）。
	const seed = selectSeed(generation, presentation);

	try {
		const variation = resolveVariation(generation, presentation);
		const prompt = buildAvatarPrompt({
			...variation,
			age: spec.age,
			genderPresentation: presentation,
			occupation: spec.occupation,
			specificRole: spec.specificRole,
			nationality: spec.nationality,
			background: spec.background,
			interests: spec.interests
		});
		const seedBytes = await readSeed(seed.fileName);
		const raw = await generateImage(prompt, seedBytes);
		const asset = await toAsset(raw);
		return { ok: true, asset };
	} catch {
		// 一時失敗の使い切り・画像未返却・後処理失敗はすべて「生成失敗」に畳む（throw しない）。
		return { ok: false, reason: 'generation_failed' };
	}
};
