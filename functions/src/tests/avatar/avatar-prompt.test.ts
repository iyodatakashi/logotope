import { describe, it, expect } from 'vitest';
import { buildAvatarPrompt, type AvatarVariation } from '../../avatar/avatar-prompt';

const sample: AvatarVariation = {
	age: 42,
	occupation: '弁護士',
	hair: 'ショートボブ',
	body: 'がっしり',
	pose: '腕組み',
	angle: '斜め約30度',
	glasses: true
};

describe('buildAvatarPrompt', () => {
	it('同一入力から同一プロンプトを返す（決定的）', () => {
		expect(buildAvatarPrompt(sample)).toBe(buildAvatarPrompt(sample));
	});

	it('seed の in-place 編集＋枠の保持を命じる（Req 3.1 の穴を塞ぐ）', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).toContain('画像編集の指示');
		expect(prompt).toContain('白紙から新しく描き起こさない');
		expect(prompt).toContain('seed の枠');
		expect(prompt).toContain('頭の位置');
	});

	it('様式（黒基調ベタ・seedの細い線描・白髪ストローク・顔なし・白背景・影なし・バストアップ）を指示する', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).toContain('黒基調でベタ塗り');
		expect(prompt).toContain('細い線描');
		expect(prompt).toContain('白髪は黒で塗らず、筋のストローク');
		expect(prompt).toContain('featureless');
		expect(prompt).toContain('ネガティブスペース');
		expect(prompt).toContain('顔・顎の輪郭線は seed');
		expect(prompt).toContain('背景は無地の白一色');
		expect(prompt).toContain('影・ドロップシャドウを描かない');
		expect(prompt).toContain('バストアップ');
		expect(prompt).toContain('正方1:1');
		expect(prompt).toContain('真剣な様子');
	});

	it('スケールは「ズーム（頭の大きさ）と目線の高さだけを seed に完全一致」で固定する（Req 4.1・4.2）', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).toContain('ズーム（頭の大きさ）と目線の高さ');
		expect(prompt).toContain('完全に一致');
		expect(prompt).toContain('枠を保ったまま');
	});

	it('マスター＋要件に無い後付け（絶対px・%・フィット/縮小/はみ出し）を含まない', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).not.toContain('px');
		expect(prompt).not.toContain('%');
		expect(prompt).not.toContain('縮小');
		expect(prompt).not.toContain('はみ出');
		expect(prompt).not.toContain('フィット');
	});

	it('与えた軸値どおりの指示文を含む', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).toContain('42歳');
		expect(prompt).toContain('ショートボブ');
		expect(prompt).toContain('がっしり');
		expect(prompt).toContain('腕組み');
		expect(prompt).toContain('斜め約30度');
		expect(prompt).toContain('弁護士にふさわしい服装');
	});

	it('メガネの有無で指示が変わる', () => {
		expect(buildAvatarPrompt({ ...sample, glasses: true })).toContain('レンズ内・目は描かない');
		expect(buildAvatarPrompt({ ...sample, glasses: false })).toContain('メガネ: なし');
	});

	it('プロンプト全体のスナップショット', () => {
		expect(buildAvatarPrompt(sample)).toMatchSnapshot();
	});
});
