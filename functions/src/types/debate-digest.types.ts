// 討論ダイジェスト（討論を圧縮した中間表現）。討論を消費者中立に圧縮した形で、
// イントロ・クロージング生成の入力に用いる。将来の事後コメント生成でも再利用できるよう、
// イントロ・クロージング固有の意図は持ち込まない。再計算を避けるためサーバー内キャッシュとして
// topics/{id}/editorial/digest に保存する（digest-cache-repository が所有・FE 非購読）。

export type ChapterDigest = {
	title: string;
	agenda: string[];
	summary: string; // 章のやり取り・提示された立場を圧縮した中立の散文
};

export type PersonaDigest = {
	personaId: string;
	name: string;
	stance: string; // 立場の要旨
	beliefShifts: string[]; // 討論で得た気づき/変化（awareness 由来）。無ければ空
};

export type DebateDigest = {
	topicTitle: string;
	chapters: ChapterDigest[];
	personas: PersonaDigest[];
};
