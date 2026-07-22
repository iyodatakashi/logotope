import { describe, it, expect } from 'vitest';
import { buildAvatarPrompt, type AvatarVariation } from '../../avatar/avatar-prompt';

const sample: AvatarVariation = {
	age: 42,
	occupation: '弁護士',
	hair: 'ショートボブ',
	body: 'がっしり',
	glasses: true,
	glassesShape: 'スクエア',
	glassesRim: '太いフルリム'
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

	it('髪型・服装・メガネに加え、体型を指示する（向き・ポーズは指示しない）', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).toContain('ショートボブ');
		expect(prompt).toContain('弁護士にふさわしい服');
		// 体型は seed で振れないので必須。向き・ポーズは編集で崩れるため指示せず seed に委ねる。
		expect(prompt).toContain(sample.body);
		expect(prompt).not.toContain('向き');
		expect(prompt).not.toContain('ポーズ');
	});

	it('後付けの曖昧・誘発語（枠・上半身・絶対px）を含まない', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).not.toContain('枠');
		expect(prompt).not.toContain('上半身');
		expect(prompt).not.toContain('px');
	});

	it('メガネの有無で指示が変わり、かける場合は形状と縁様式を合成する', () => {
		expect(buildAvatarPrompt({ ...sample, glasses: true })).toContain('レンズ内と目は描かない');
		const withFrame = buildAvatarPrompt({
			...sample,
			glasses: true,
			glassesShape: '丸',
			glassesRim: '細い縁が下側だけのアンダーリム（上側は縁なし）'
		});
		expect(withFrame).toContain('丸');
		expect(withFrame).toContain('アンダーリム');
		expect(buildAvatarPrompt({ ...sample, glasses: false })).toContain('メガネはかけない');
	});

	it('白髪は条件付きの描画ルールで示す（無条件に全員白髪にしない）', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).toContain('白髪を描く場合は');
		expect(prompt).toContain('白い細い筋');
	});

	it('プロンプト全体のスナップショット', () => {
		expect(buildAvatarPrompt(sample)).toMatchSnapshot();
	});
});
