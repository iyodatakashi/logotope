// 公開一覧の読み取り専用の出力型。読み取り入力は Admin の TopicForFirestore を境界で cast して参照する（published-topics.ts）。
// published は載せない（公開クエリが true を保証）。personaCount も載せない（一覧に不要）。
export type PublishedTopic = {
	id: string;
	title: string;
	publishedAt: Date;
};
