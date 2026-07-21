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

	it('編集ベースで、保つもの（正方・頭サイズ・目線・様式）を指示する', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).toContain('画像編集の指示');
		expect(prompt).toContain('正方形');
		expect(prompt).toContain('頭の大きさ（画面に占める頭のサイズ）と目線の高さ');
		expect(prompt).toContain('黒基調のシルエット');
		expect(prompt).toContain('顔は描かない');
		expect(prompt).toContain('ネガティブスペース');
		expect(prompt).toContain('背景は白一色');
		expect(prompt).toContain('影は描かない');
	});

	it('変えるのは髪型・服装・メガネのみ（向き・体型・ポーズは指示しない）', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).toContain('ショートボブ');
		expect(prompt).toContain('弁護士にふさわしい服');
		// 向き・体型・ポーズは編集で崩れる（新規生成に倒れる）ので指示に含めない。
		expect(prompt).not.toContain('アングル');
		expect(prompt).not.toContain('ポーズ');
		expect(prompt).not.toContain('体型');
	});

	it('後付けの曖昧・誘発語（枠・上半身・絶対px）を含まない', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).not.toContain('枠');
		expect(prompt).not.toContain('上半身');
		expect(prompt).not.toContain('px');
	});

	it('メガネの有無で指示が変わる', () => {
		expect(buildAvatarPrompt({ ...sample, glasses: true })).toContain('レンズ内と目は描かない');
		expect(buildAvatarPrompt({ ...sample, glasses: false })).toContain('メガネはかけない');
	});

	it('白髪の指示は高齢（50歳以上）のみに含める', () => {
		expect(buildAvatarPrompt({ ...sample, age: 40 })).not.toContain('白い細い筋');
		expect(buildAvatarPrompt({ ...sample, age: 62 })).toContain('白い細い筋');
	});

	it('プロンプト全体のスナップショット', () => {
		expect(buildAvatarPrompt(sample)).toMatchSnapshot();
	});
});
