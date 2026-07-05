// 討論全体のイントロ（冒頭）・クロージング（末尾）成果物。topic に対し 1:1（固定 ID '0'）。
// intro / closing は独立に生成・保存され、未生成/失敗は null（片方のみ存在し得る）。
// Firestore 永続形（Functions 側 EditedIntroClosingForFirestore）と一致させる。変換関数は持たない。
export type EditedIntroClosingForFirestore = {
	intro: string | null;
	closing: string | null;
};

export type EditedIntroClosing = EditedIntroClosingForFirestore & { id: string };
