import { describe, it, expect } from 'vitest';
import {
	resolveVariation,
	HAIR_CATALOG,
	BODY_CATALOG,
	GLASSES_SHAPE_CATALOG,
	GLASSES_RIM_CATALOG
} from '../../avatar/avatar-variation';

describe('resolveVariation', () => {
	it('各軸の値は対応するカタログから引く', () => {
		const v = resolveVariation('middle', 'masculine');
		expect(HAIR_CATALOG.middle.masculine).toContain(v.hair);
		expect(BODY_CATALOG).toContain(v.body);
		expect(typeof v.glasses).toBe('boolean');
		expect(GLASSES_SHAPE_CATALOG).toContain(v.glassesShape);
		expect(GLASSES_RIM_CATALOG).toContain(v.glassesRim);
	});

	it('髪型は世代×外見表現ごとの語彙から引く', () => {
		const child = resolveVariation('child', 'feminine');
		expect(HAIR_CATALOG.child.feminine).toContain(child.hair);
	});

	it('生成のたびにランダムで、髪型・体型・メガネの形状/縁がそれぞれ複数に散る', () => {
		const vs = Array.from({ length: 300 }, () => resolveVariation('young', 'feminine'));
		expect(new Set(vs.map((v) => v.hair)).size).toBeGreaterThan(1);
		expect(new Set(vs.map((v) => v.body)).size).toBeGreaterThan(1);
		expect(new Set(vs.map((v) => v.glassesShape)).size).toBeGreaterThan(1);
		expect(new Set(vs.map((v) => v.glassesRim)).size).toBeGreaterThan(1);
	});

	it('メガネは着けたり着けなかったりする（両方が現れる）', () => {
		const glasses = Array.from({ length: 300 }, () => resolveVariation('middle', 'feminine').glasses);
		expect(glasses).toContain(true);
		expect(glasses).toContain(false);
	});
});
