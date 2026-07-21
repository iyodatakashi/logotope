import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { toAsset } from '../../avatar/avatar-postprocess';
import { ASSET_SIZE } from '../../avatar/avatar-constants';

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

interface Decoded {
	data: Buffer;
	width: number;
	height: number;
	channels: number;
}

const decode = async (buf: Uint8Array): Promise<Decoded> => {
	const { data, info } = await sharp(Buffer.from(buf))
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height, channels: info.channels };
};

const readInput = async (): Promise<Uint8Array> =>
	new Uint8Array(await readFile(fixture('postprocess-input.png')));

describe('toAsset', () => {
	it('同一入力に決定的に同一 PNG を返す（Req 6.4）', async () => {
		const input = await readInput();
		const a = await toAsset(input);
		const b = await toAsset(input);
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
	});

	it('256×256・RGB=黒のアルファ透過 PNG を出す（Req 6.4 / 独立着色可能な形態）', async () => {
		const { data, width, height, channels } = await decode(await toAsset(await readInput()));
		expect(width).toBe(ASSET_SIZE);
		expect(height).toBe(ASSET_SIZE);
		expect(channels).toBe(4);

		let rgbNonZero = 0;
		let hasAlpha = false;
		for (let i = 0; i < width * height; i++) {
			if (data[i * 4] || data[i * 4 + 1] || data[i * 4 + 2]) rgbNonZero++;
			if (data[i * 4 + 3] > 0) hasAlpha = true;
		}
		// RGB は全画素黒＝色を持たずアルファのみ。シルエット色/背景色を再生成なしに独立指定できる。
		expect(rgbNonZero).toBe(0);
		expect(hasAlpha).toBe(true);
	});

	it('明るい要素は透明に落とさず薄いアルファ階調で残す（Req 6.3）', async () => {
		const { data, width, height } = await decode(await toAsset(await readInput()));
		let faint = 0;
		let opaque = 0;
		for (let i = 0; i < width * height; i++) {
			const alpha = data[i * 4 + 3];
			if (alpha > 0 && alpha < 160) faint++;
			if (alpha >= 230) opaque++;
		}
		// 半透明の階調が残る（ハード2値化でない）＝白髪の筋などが薄く残る。
		expect(faint).toBeGreaterThan(0);
		// 被写体本体はほぼ不透明。
		expect(opaque).toBeGreaterThan(0);
	});

	it('postprocess.py のゴールデンとアルファが等価（縁のリサンプラ差のみ許容）', async () => {
		const golden = await decode(new Uint8Array(await readFile(fixture('postprocess-golden.png'))));
		const mine = await decode(await toAsset(await readInput()));
		expect(mine.width).toBe(golden.width);
		expect(mine.height).toBe(golden.height);

		const n = golden.width * golden.height;
		let max = 0;
		let sum = 0;
		let over8 = 0;
		for (let i = 0; i < n; i++) {
			const diff = Math.abs(golden.data[i * 4 + 3] - mine.data[i * 4 + 3]);
			if (diff > max) max = diff;
			sum += diff;
			if (diff > 8) over8++;
		}
		// アルゴリズムは postprocess.py と等価。差は sharp(lanczos3) と PIL(LANCZOS) の
		// 縁のアンチエイリアスのみで、平均差はほぼ0・大きく外れるのは縁のごく一部（実測: 平均0.035 /
		// >8 は 33/65536 / 最大20）。
		expect(sum / n).toBeLessThan(0.5);
		expect(over8).toBeLessThan(n * 0.002);
		expect(max).toBeLessThanOrEqual(32);
	});
});
