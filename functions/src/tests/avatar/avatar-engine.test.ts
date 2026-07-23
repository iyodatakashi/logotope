import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const { mockGenerateImage } = vi.hoisted(() => ({ mockGenerateImage: vi.fn() }));
vi.mock('../../avatar/avatar-image-client', () => ({ generateImage: mockGenerateImage }));

import { generateAvatarAsset, type AvatarSpec } from '../../avatar/avatar-engine';
import {
	seedFileName,
	SEED_INDICES,
	type SeedGeneration,
	type Presentation
} from '../../avatar/avatar-seeds';

const seedBytes = (fileName: string): Promise<Buffer> =>
	readFile(fileURLToPath(new URL(`../../../seeds/${fileName}`, import.meta.url)));
const fixturePng = (): Promise<Buffer> =>
	readFile(fileURLToPath(new URL('./fixtures/postprocess-input.png', import.meta.url)));

// ランダム選択なので、渡る seed は「その seed 世代・外見表現のプール（6枚）のどれか」で判定する。
// 年齢由来の世代は seed の世代（child/middle/elder）へ写るため、プールは seed 世代で指定する。
const poolBytes = (generation: SeedGeneration, presentation: Presentation): Promise<Buffer[]> =>
	Promise.all(SEED_INDICES.map((i) => seedBytes(seedFileName({ generation, presentation }, i))));
const inPool = (passed: Uint8Array, pool: Buffer[]): boolean =>
	pool.some((b) => b.equals(Buffer.from(passed)));

const baseSpec: AvatarSpec = {
	age: 42,
	genderPresentation: 'masculine',
	occupation: '弁護士',
	specificRole: '弁護士',
	nationality: '日本',
	background: '都内在住。企業法務を専門とする。',
	interests: '読書'
};

beforeEach(async () => {
	vi.clearAllMocks();
	// モデルは有効な PNG を返す前提（後処理が実際に走る）。
	mockGenerateImage.mockResolvedValue(new Uint8Array(await fixturePng()));
});

describe('generateAvatarAsset', () => {
	it('正常時は 256×256 の透過 PNG アセットを返す', async () => {
		const result = await generateAvatarAsset(baseSpec);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const meta = await sharp(Buffer.from(result.asset)).metadata();
		expect(meta.width).toBe(256);
		expect(meta.height).toBe(256);
		expect(meta.channels).toBe(4);
	});

	it('その世代・外見表現のプールの seed とプロンプトでモデルを1回呼ぶ', async () => {
		await generateAvatarAsset(baseSpec);

		expect(mockGenerateImage).toHaveBeenCalledTimes(1);
		const [prompt, passedSeed] = mockGenerateImage.mock.calls[0];
		expect(typeof prompt).toBe('string');
		// spec の外見・具体プロフィールがプロンプトに反映される（性別の錨・立場）。
		expect(prompt).toContain('男性的な外見');
		expect(prompt).toContain('弁護士');
		expect(inPool(passedSeed, await poolBytes('middle', 'masculine'))).toBe(true);
	});

	it('androgynous も生成し、その世代・外見表現のプールの seed を渡す', async () => {
		const result = await generateAvatarAsset({ ...baseSpec, genderPresentation: 'androgynous' });
		expect(result.ok).toBe(true);
		expect(mockGenerateImage).toHaveBeenCalledTimes(1);
		const [prompt, passedSeed] = mockGenerateImage.mock.calls[0];
		expect(prompt).toContain('中性的な外見');
		expect(inPool(passedSeed, await poolBytes('middle', 'androgynous'))).toBe(true);
	});

	it('生成失敗（モデルが投げる）は generation_failed を返す（throw しない）', async () => {
		mockGenerateImage.mockRejectedValueOnce(new Error('使い切り'));
		const result = await generateAvatarAsset(baseSpec);
		expect(result).toEqual({ ok: false, reason: 'generation_failed' });
	});

	it('後処理が失敗する不正な画像でも generation_failed に畳む', async () => {
		mockGenerateImage.mockResolvedValueOnce(new Uint8Array([0, 1, 2, 3])); // PNG でない
		const result = await generateAvatarAsset(baseSpec);
		expect(result).toEqual({ ok: false, reason: 'generation_failed' });
	});

	it('世代境界（69/70）で seed の世代が切り替わる（senior→middle 流用 / elder）', async () => {
		await generateAvatarAsset({ ...baseSpec, age: 69 }); // senior → middle の seed を流用
		await generateAvatarAsset({ ...baseSpec, age: 70 }); // elder
		const [, seniorPassed] = mockGenerateImage.mock.calls[0];
		const [, elderPassed] = mockGenerateImage.mock.calls[1];
		expect(inPool(seniorPassed, await poolBytes('middle', 'masculine'))).toBe(true);
		expect(inPool(elderPassed, await poolBytes('elder', 'masculine'))).toBe(true);
	});
});
