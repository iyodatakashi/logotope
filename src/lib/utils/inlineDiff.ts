import diff_match_patch from 'diff-match-patch';

// 原本と編集後の文章をインライン差分セグメントへ変換する。
// google/diff-match-patch を使い、意味単位で差分を整えてから表示用の型へ写す。
export type InlineDiffSegment = {
	type: 'equal' | 'insert' | 'delete';
	text: string;
};

export const computeInlineDiff = (original: string, edited: string): InlineDiffSegment[] => {
	const dmp = new diff_match_patch();
	const diffs = dmp.diff_main(original, edited);
	// 文字単位のノイズをまとめ、人間が読みやすい単位の差分にする。
	dmp.diff_cleanupSemantic(diffs);
	return diffs.map(([op, text]) => ({
		type: op === -1 ? 'delete' : op === 1 ? 'insert' : 'equal',
		text
	}));
};
