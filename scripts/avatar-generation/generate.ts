// 指示駆動の生成オーケストレーション: バリエーション仕様から規範プロンプトと参照画像を
// 組み立て（buildPrompt）、画像生成モデルを呼んで白背景の候補画像を保存する。
// モデル呼び出しと保存は注入し、組み立て・命名・保存の流れをテスト可能にする。

import { buildPrompt } from './prompt-builder';
import { assetFileName, type AvatarIndividual } from './variation-spec';

export type GenerateImage = (prompt: string, referenceImages: string[]) => Promise<Uint8Array>;

export interface GenerationDeps {
	generateImage: GenerateImage;
	writeCandidate: (fileName: string, data: Uint8Array) => Promise<void>;
}

// 後処理前の白背景候補の命名。正規アセット名に candidate_ を付け、資産化前後を取り違えない。
export const candidateFileName = (individual: AvatarIndividual): string =>
	`candidate_${assetFileName(individual)}`;

export const runGeneration = async (
	individual: AvatarIndividual,
	deps: GenerationDeps
): Promise<string> => {
	const { prompt, referenceImages } = buildPrompt(individual);
	const image = await deps.generateImage(prompt, referenceImages);
	const fileName = candidateFileName(individual);
	await deps.writeCandidate(fileName, image);
	return fileName;
};
