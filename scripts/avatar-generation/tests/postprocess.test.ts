import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../postprocess.py', import.meta.url));
const py = (code: string, args: string[] = []): string =>
	execFileSync('python3', ['-c', code, ...args], { encoding: 'utf8' });

// 非正方（200x160）の白背景に黒い被写体を置くフィクスチャ。寸法不足の入力の後処理も確認する。
const MAKE_FIXTURE = `
from PIL import Image, ImageDraw
import sys
im = Image.new('RGB', (200, 160), (255, 255, 255))
ImageDraw.Draw(im).rectangle([60, 40, 140, 140], fill=(0, 0, 0))
im.save(sys.argv[1])
`;
const INSPECT = `
from PIL import Image
import sys, json
im = Image.open(sys.argv[1])
a = im.getchannel('A')
print(json.dumps({'size': list(im.size), 'mode': im.mode,
  'corner': a.getpixel((0, 0)), 'center': a.getpixel((128, 128))}))
`;

describe('後処理: 白背景 → 正規アセット（輝度→アルファ・正方1:1・256px）', () => {
	const dir = mkdtempSync(join(tmpdir(), 'avatar-postprocess-'));
	const input = join(dir, 'candidate.png');
	const output = join(dir, 'asset.png');
	py(MAKE_FIXTURE, [input]);
	execFileSync('python3', [SCRIPT, input, output]);

	it('出力は 256×256px の RGBA（アルファ透過）である（Req 6.1, 5.3）', () => {
		const info = JSON.parse(py(INSPECT, [output]));
		expect(info.size).toEqual([256, 256]);
		expect(info.mode).toBe('RGBA');
	});

	it('黒=不透明・白=透明の輝度→アルファ変換になっている（Req 4.2, 5.4）', () => {
		const info = JSON.parse(py(INSPECT, [output]));
		expect(info.corner).toBe(0); // 白背景 → 透明
		expect(info.center).toBe(255); // 黒被写体 → 不透明
	});

	it('同一入力から決定的に同一バイト列が得られる（再実行で一致・Req 6.3）', () => {
		const rerun = join(dir, 'asset-rerun.png');
		execFileSync('python3', [SCRIPT, input, rerun]);
		expect(readFileSync(rerun)).toEqual(readFileSync(output));
	});
});
