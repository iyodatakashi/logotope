import { describe, it, expect } from 'vitest';
import { buildAvatarPrompt, type AvatarVariation } from '../../avatar/avatar-prompt';

const sample: AvatarVariation = {
	age: 42,
	genderPresentation: 'feminine',
	occupation: '弁護士',
	specificRole: '刑事事件専門の弁護士',
	nationality: '日本',
	background: '都内在住。企業を早期退職して独立し、生活は安定している。',
	interests: '登山',
	hair: 'ショートボブ',
	aestheticKeyword: null,
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

	it('性別と年代を本文で明示して錨にする（別人化で seed の性別が上書きされるのを防ぐ）', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).toContain('女性的な外見');
		expect(prompt).toContain('元画像の性別を保ち');
		expect(prompt).toContain('42歳相当');
		// masculine では男性的な外見になる
		expect(buildAvatarPrompt({ ...sample, genderPresentation: 'masculine' })).toContain(
			'男性的な外見'
		);
	});

	it('服装はペルソナの立場・実態に合わせ、一律にスーツにも一律にカジュアルにもしない', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).toContain('ふさわしい');
		expect(prompt).toContain('一律に'); // 一律スーツも一律カジュアルもしない
		expect(prompt).toContain(sample.specificRole);
		expect(prompt).toContain(sample.nationality);
		expect(prompt).toContain(sample.interests);
		expect(prompt).toContain(sample.background);
		// 背景を渡しても情景・小物は描かせない
		expect(prompt).toContain('情景は描かない');
	});

	it('髪型・体型・メガネは可変軸で指示する（向き・ポーズは指示しない）', () => {
		const prompt = buildAvatarPrompt(sample);
		expect(prompt).toContain('ショートボブ');
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

	it('審美観コードは、あるときだけ雰囲気の寄せ先として英語キーワードで添える', () => {
		expect(buildAvatarPrompt({ ...sample, aestheticKeyword: 'ulzzang style' })).toContain(
			'ulzzang style'
		);
		// null（「なし」）のときは審美観の行を足さない
		expect(buildAvatarPrompt({ ...sample, aestheticKeyword: null })).not.toContain('英語キーワード');
	});

	it('プロンプト全体のスナップショット', () => {
		expect(buildAvatarPrompt(sample)).toMatchSnapshot();
	});
});
