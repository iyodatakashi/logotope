// 公開一覧の読み取り専用・最小射影。Admin 型（Topic / TopicStates / *ForFirestore）とは分離する。
// published は載せない（公開クエリが true を保証）。personaCount も載せない（一覧に不要）。
export type PublishedTopic = {
	id: string;
	title: string;
	publishedAt: Date;
};
