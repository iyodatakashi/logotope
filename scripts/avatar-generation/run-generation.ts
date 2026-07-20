// オフライン生成の実行エントリ。指定した個体（年齢帯 性別 serial…）の白背景候補を生成し
// candidates/ に保存する。実モデル（Gemini）と GEMINI_API_KEY が利用可能な環境で走らせる。
//
//   node run-generation.ts thirties_forties female 01 02
//
// 本リポジトリのルートには @ai-sdk/google 未インストールのため、実行は functions 相当の
// 依存を持つ環境で行う（本フィジビリ環境では実行しない）。

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGeneration } from './generate';
import { createGeminiImageClient } from './gemini-image-client';
import { resolveVariation, type AgeBand, type Gender } from './variation-spec';

const main = async (): Promise<void> => {
	const [ageBand, gender, ...serials] = process.argv.slice(2);
	if (!ageBand || !gender || serials.length === 0) {
		throw new Error('usage: run-generation.ts <ageBand> <gender> <serial...>');
	}

	const candidatesDir = join(dirname(fileURLToPath(import.meta.url)), 'candidates');
	await mkdir(candidatesDir, { recursive: true });
	const generateImage = createGeminiImageClient();

	for (const serial of serials) {
		const individual = resolveVariation(ageBand as AgeBand, gender as Gender, serial);
		const fileName = await runGeneration(individual, {
			generateImage,
			writeCandidate: (name, data) => writeFile(join(candidatesDir, name), data)
		});
		console.log(`generated: ${fileName}`);
	}
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
