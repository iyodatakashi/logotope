// 画像モデル呼び出しアダプタ。プロンプトと seed（編集の元画像）から画像バイト列を得る。
//
// seed は file パートで添付し、TEXT+IMAGE モダリティを明示する（未指定だとテキストのみ返る）。
// 一時失敗（API エラー）と画像未返却は数回リトライし、使い切ると throw する
// （呼び出し側の avatar-engine が {ok:false, generation_failed} に変換する）。

import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { AVATAR_IMAGE_MODEL } from '../constants/ai.constants.js';

/** リトライ回数（初回＋再試行の合計）。一時失敗を数回吸収し、使い切りで失敗とする。 */
export const MAX_ATTEMPTS = 3;

export const generateImage = async (prompt: string, seed: Uint8Array): Promise<Uint8Array> => {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) throw new Error('GEMINI_API_KEY が未設定');
	const google = createGoogleGenerativeAI({ apiKey });

	let lastError: unknown = new Error('画像が返らなかった');
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		try {
			const result = await generateText({
				model: google(AVATAR_IMAGE_MODEL),
				// 画像モーダリティを明示する（未指定だとテキストのみ返る）。
				providerOptions: { google: { responseModalities: ['TEXT', 'IMAGE'] } },
				messages: [
					{
						role: 'user',
						content: [
							{ type: 'text', text: prompt },
							{ type: 'file', data: seed, mediaType: 'image/png' }
						]
					}
				]
			});
			const image = result.files.find((file) => file.mediaType?.startsWith('image/'));
			if (image) return image.uint8Array;
			lastError = new Error('画像が返らなかった');
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError;
};
