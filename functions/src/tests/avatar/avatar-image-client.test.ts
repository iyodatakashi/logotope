import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGenerateText, mockModelFactory } = vi.hoisted(() => ({
	mockGenerateText: vi.fn(),
	mockModelFactory: vi.fn((id: string) => ({ _modelId: id }))
}));

vi.mock('ai', () => ({ generateText: mockGenerateText }));
vi.mock('@ai-sdk/google', () => ({
	createGoogleGenerativeAI: vi.fn(() => mockModelFactory)
}));

import { generateImage, MAX_ATTEMPTS } from '../../avatar/avatar-image-client';
import { AVATAR_IMAGE_MODEL } from '../../constants/ai.constants';

const imageResult = (bytes: number[]) => ({
	files: [{ mediaType: 'image/png', uint8Array: new Uint8Array(bytes) }]
});
const noImageResult = () => ({ files: [{ mediaType: 'text/plain', uint8Array: new Uint8Array() }] });

const savedKey = process.env.GEMINI_API_KEY;

beforeEach(() => {
	vi.clearAllMocks();
	process.env.GEMINI_API_KEY = 'test-key';
});

afterEach(() => {
	if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
	else delete process.env.GEMINI_API_KEY;
});

describe('generateImage', () => {
	it('プロンプト＋seed から画像バイト列を返す', async () => {
		mockGenerateText.mockResolvedValueOnce(imageResult([1, 2, 3]));
		const out = await generateImage('prompt', new Uint8Array([9, 9]));
		expect(Array.from(out)).toEqual([1, 2, 3]);
	});

	it('AVATAR_IMAGE_MODEL を TEXT+IMAGE で呼び、seed を file パートで添付する', async () => {
		mockGenerateText.mockResolvedValueOnce(imageResult([1]));
		const seed = new Uint8Array([7, 7, 7]);
		await generateImage('この元画像を編集', seed);

		expect(mockModelFactory).toHaveBeenCalledWith(AVATAR_IMAGE_MODEL);
		const call = mockGenerateText.mock.calls[0][0];
		expect(call.providerOptions.google.responseModalities).toEqual(['TEXT', 'IMAGE']);
		const parts = call.messages[0].content;
		expect(parts).toContainEqual({ type: 'text', text: 'この元画像を編集' });
		expect(parts).toContainEqual({ type: 'file', data: seed, mediaType: 'image/png' });
	});

	it('画像未返却はリトライし、後続で返れば成功する', async () => {
		mockGenerateText
			.mockResolvedValueOnce(noImageResult())
			.mockResolvedValueOnce(imageResult([5]));
		const out = await generateImage('p', new Uint8Array());
		expect(Array.from(out)).toEqual([5]);
		expect(mockGenerateText).toHaveBeenCalledTimes(2);
	});

	it('一時失敗（例外）はリトライし、後続で返れば成功する', async () => {
		mockGenerateText
			.mockRejectedValueOnce(new Error('一時的なAPIエラー'))
			.mockResolvedValueOnce(imageResult([8]));
		const out = await generateImage('p', new Uint8Array());
		expect(Array.from(out)).toEqual([8]);
		expect(mockGenerateText).toHaveBeenCalledTimes(2);
	});

	it('リトライを使い切ると失敗（throw）する', async () => {
		mockGenerateText.mockResolvedValue(noImageResult());
		await expect(generateImage('p', new Uint8Array())).rejects.toThrow();
		expect(mockGenerateText).toHaveBeenCalledTimes(MAX_ATTEMPTS);
	});

	it('GEMINI_API_KEY 未設定なら呼ばずに失敗する', async () => {
		delete process.env.GEMINI_API_KEY;
		await expect(generateImage('p', new Uint8Array())).rejects.toThrow('GEMINI_API_KEY');
		expect(mockGenerateText).not.toHaveBeenCalled();
	});
});
