import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const { mockGenerateImage } = vi.hoisted(() => ({ mockGenerateImage: vi.fn() }));
vi.mock('../../avatar/avatar-image-client', () => ({ generateImage: mockGenerateImage }));

import { generateAvatarAsset, type AvatarSpec } from '../../avatar/avatar-engine';
import { toGeneration, selectSeed } from '../../avatar/avatar-seeds';
import { resolveVariation } from '../../avatar/avatar-variation';
import { buildAvatarPrompt } from '../../avatar/avatar-prompt';

const seedBytes = (fileName: string): Promise<Buffer> =>
	readFile(fileURLToPath(new URL(`../../avatar/seeds/${fileName}`, import.meta.url)));
const fixturePng = (): Promise<Buffer> =>
	readFile(fileURLToPath(new URL('./fixtures/postprocess-input.png', import.meta.url)));

const baseSpec: AvatarSpec = {
	personaId: 'p1',
	attempt: 0,
	age: 42,
	genderPresentation: 'masculine',
	occupation: '弁護士'
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

	it('seed 選択→可変軸→プロンプト→モデルの結線: 決定的な seed とプロンプトを渡す', async () => {
		await generateAvatarAsset(baseSpec);

		const generation = toGeneration(baseSpec.age); // middle
		const seed = selectSeed(baseSpec.personaId, baseSpec.attempt, generation, 'masculine')!;
		const expectedSeed = await seedBytes(seed.fileName);
		const expectedPrompt = buildAvatarPrompt({
			...resolveVariation(baseSpec.personaId, baseSpec.attempt, generation, 'masculine'),
			age: baseSpec.age,
			occupation: baseSpec.occupation
		});

		expect(mockGenerateImage).toHaveBeenCalledTimes(1);
		const [prompt, passedSeed] = mockGenerateImage.mock.calls[0];
		expect(prompt).toBe(expectedPrompt);
		expect(Buffer.from(passedSeed).equals(expectedSeed)).toBe(true);
	});

	it('androgynous は生成せず no_seed を返す（モデルを呼ばない）', async () => {
		const result = await generateAvatarAsset({ ...baseSpec, genderPresentation: 'androgynous' });
		expect(result).toEqual({ ok: false, reason: 'no_seed' });
		expect(mockGenerateImage).not.toHaveBeenCalled();
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

	it('同一 (personaId, attempt) は常に同一 seed・同一プロンプトで呼ぶ（決定的）', async () => {
		await generateAvatarAsset(baseSpec);
		await generateAvatarAsset(baseSpec);
		const [p1, s1] = mockGenerateImage.mock.calls[0];
		const [p2, s2] = mockGenerateImage.mock.calls[1];
		expect(p1).toBe(p2);
		expect(Buffer.from(s1).equals(Buffer.from(s2))).toBe(true);
	});

	it('世代境界（69/70）で別世代の seed に切り替わって渡る', async () => {
		await generateAvatarAsset({ ...baseSpec, age: 69 }); // senior
		await generateAvatarAsset({ ...baseSpec, age: 70 }); // elder
		const seniorSeed = selectSeed(baseSpec.personaId, 0, 'senior', 'masculine')!;
		const elderSeed = selectSeed(baseSpec.personaId, 0, 'elder', 'masculine')!;
		expect(seniorSeed.fileName).toContain('senior');
		expect(elderSeed.fileName).toContain('elder');

		const [, seniorPassed] = mockGenerateImage.mock.calls[0];
		const [, elderPassed] = mockGenerateImage.mock.calls[1];
		expect(Buffer.from(seniorPassed).equals(await seedBytes(seniorSeed.fileName))).toBe(true);
		expect(Buffer.from(elderPassed).equals(await seedBytes(elderSeed.fileName))).toBe(true);
	});
});
