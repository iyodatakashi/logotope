import { describe, it, expect } from 'vitest';
import { runGeneration, candidateFileName, type GenerationDeps } from '../generate';
import { resolveVariation } from '../variation-spec';

const spec = resolveVariation('thirties_forties', 'female', '01');

const fakeDeps = () => {
	const calls = {
		prompt: '',
		referenceImages: [] as string[],
		written: new Map<string, Uint8Array>()
	};
	const deps: GenerationDeps = {
		generateImage: async (prompt, referenceImages) => {
			calls.prompt = prompt;
			calls.referenceImages = referenceImages;
			return new Uint8Array([137, 80, 78, 71]); // PNG シグネチャ相当のダミー
		},
		writeCandidate: async (fileName, data) => {
			calls.written.set(fileName, data);
		}
	};
	return { deps, calls };
};

describe('指示駆動の生成オーケストレーション（Req 3.1, 3.2）', () => {
	it('規範プロンプトと参照画像（最大3枚）を組み立ててモデルに渡す', async () => {
		const { deps, calls } = fakeDeps();
		await runGeneration(spec, deps);
		expect(calls.prompt).toContain(spec.hairStyle);
		expect(calls.prompt).toContain(spec.outfit);
		expect(calls.referenceImages.length).toBeGreaterThan(0);
		expect(calls.referenceImages.length).toBeLessThanOrEqual(3);
	});

	it('候補画像をファイルとして保存し命名する（完了条件: 候補がファイルとして保存される）', async () => {
		const { deps, calls } = fakeDeps();
		const fileName = await runGeneration(spec, deps);
		expect(fileName).toBe(candidateFileName(spec));
		expect(calls.written.get(fileName)).toEqual(new Uint8Array([137, 80, 78, 71]));
	});

	it('serial が違えばモデルに渡すプロンプトが変わる（モデル裁量任せでなく指定で出し分け・Req 2.2）', async () => {
		const a = fakeDeps();
		await runGeneration(resolveVariation('thirties_forties', 'female', '01'), a.deps);
		const b = fakeDeps();
		await runGeneration(resolveVariation('thirties_forties', 'female', '02'), b.deps);
		expect(a.calls.prompt).not.toBe(b.calls.prompt);
	});
});
