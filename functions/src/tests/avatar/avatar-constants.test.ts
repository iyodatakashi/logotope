import { describe, it, expect } from 'vitest';
import {
	ASSET_SIZE,
	SEED_CANVAS,
	SUBJECT_HEIGHT_RATIO,
	SHADOW_CUTOFF
} from '../../avatar/avatar-constants';

describe('avatar-constants', () => {
	it('効く定数を単一の定義元から提供する', () => {
		expect(ASSET_SIZE).toBe(256);
		expect(SUBJECT_HEIGHT_RATIO).toBe(0.92);
		expect(SHADOW_CUTOFF).toBe(36);
	});

	it('seed キャンバスとアセットは同一の枠にする（ずれると生成物の枠がぶれる）', () => {
		expect(SEED_CANVAS).toBe(ASSET_SIZE);
	});

	it('却下値（縦占有 0.855）を採用しない', () => {
		expect(SUBJECT_HEIGHT_RATIO).not.toBe(0.855);
	});
});
