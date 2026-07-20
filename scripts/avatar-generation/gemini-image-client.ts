// 実モデル呼び出しアダプタ: Gemini 3.1 Flash Image を @ai-sdk/google 経由で呼ぶ。
// 旧 gemini-2.5-flash-image は 2026-10-02 停止予定のため移行済み。既存アセットは 2.5 で生成
// されているため、本モデルでのスタイル再現性は試験生成で確認すること。
// functions 側の createGoogleGenerativeAI 利用パターン（GEMINI_API_KEY）に合わせる。
// 依存（@ai-sdk/google, ai）は遅延 import。オフライン生成を実行する環境でのみ解決される
// （本リポジトリのルートには未インストール。実行時は functions 相当の環境／鍵が必要）。

import type { GenerateImage } from './generate';

export const createGeminiImageClient = (): GenerateImage => {
	return async (prompt, referenceImages) => {
		const apiKey = process.env.GEMINI_API_KEY;
		if (!apiKey) throw new Error('GEMINI_API_KEY が未設定');

		const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
		const { generateText } = await import('ai');
		const { readFile } = await import('node:fs/promises');

		const google = createGoogleGenerativeAI({ apiKey });
		const attachments = await Promise.all(referenceImages.map((path) => readFile(path)));

		const result = await generateText({
			model: google('gemini-3.1-flash-image'),
			// 画像モーダリティを明示（未指定だとテキストのみ返る）
			providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } },
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: prompt },
						...attachments.map((data) => ({
							type: 'file' as const,
							data,
							mediaType: 'image/png' as const
						}))
					]
				}
			]
		});

		const image = result.files.find((file) => file.mediaType?.startsWith('image/'));
		if (!image) throw new Error('画像が生成されなかった');
		return image.uint8Array;
	};
};
