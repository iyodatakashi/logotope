import { getFirestore } from 'firebase-admin/firestore';
import type {
	EditorialForFirestore,
	Narration,
	ImpressionForFirestore
} from '../../types/editorial.types.js';

// 導入・締め・所感を1つにまとめた統合ドキュメント editorial/outputs の読み取りと部分上書き（blind write）。
// 各 set は対象項目だけを書き、ドキュメント全体を読み直さず他要素を読み書きしない。
// 別々の項目への更新は同時でも衝突しない（R6.2）。原本（討論生データ）は一切変更しない。
// ダイジェストキャッシュ（editorial/digest）とは別ドキュメントに分離する（成果物のみ FE 購読対象）。

const db = () => getFirestore();

const editorialRef = (topicId: string) => db().doc(`topics/${topicId}/editorial/outputs`);

// 未着手の editorial（導入・締め・所感）（生成待ち・内容空）。生成待ちと失敗は内容が同じ（空）でステータスのみで区別する。
const emptyNarration = (): Narration => ({ status: 'pending', draft: null, final: null });

/** 統合ドキュメントを読み取る。欠落項目は生成待ち（status='pending'・内容空）/ impressions={} で補完して返す */
export const readEditorial = async (topicId: string): Promise<EditorialForFirestore> => {
	const snap = await editorialRef(topicId).get();
	const data = snap.exists ? (snap.data() as Partial<EditorialForFirestore>) : {};
	return {
		intro: data.intro ?? emptyNarration(),
		outro: data.outro ?? emptyNarration(),
		impressions: data.impressions ?? {}
	};
};

/** 導入を部分上書きする（intro 項目全体・他要素不変） */
export const setIntro = async (topicId: string, part: Narration): Promise<void> => {
	await editorialRef(topicId).update({ intro: part });
};

/** 締めを部分上書きする（outro 項目全体・他要素不変） */
export const setOutro = async (topicId: string, part: Narration): Promise<void> => {
	await editorialRef(topicId).update({ outro: part });
};

/** 所感1人分を personaId キーで部分上書きする（当該ペルソナ全体・他要素不変） */
export const setImpression = async (
	topicId: string,
	personaId: string,
	part: ImpressionForFirestore
): Promise<void> => {
	await editorialRef(topicId).update({ [`impressions.${personaId}`]: part });
};

/**
 * 統合ドキュメントを初期化する（編集開始・やり直し時の破棄）。
 * 導入・締めを生成待ち（pending）で作り、所感は空マップにして以降の部分上書きを可能にする。
 */
export const clearEditorial = async (topicId: string): Promise<void> => {
	await editorialRef(topicId).set({
		intro: emptyNarration(),
		outro: emptyNarration(),
		impressions: {}
	});
};

// editorial（導入・締め・所感）1つを「生成中 →（原本成功で）整え中 → 完了」で段階的に部分上書きするハンドル（blind write）。
// build（一括生成・個別再生成）が生成の進行に合わせて呼ぶ。段階ごとに status を書くため FE が途中経過を出せる。
export type EditorialWriter = {
	// 生成開始: 生成中にし内容を破棄する（再生成では旧 draft/final を即時に消す）
	markEditorialGenerating: () => Promise<void>;
	// 原本生成 成功: 整え中にし原本を保存する（final は未確定のまま）
	markEditorialEditing: (draft: string) => Promise<void>;
	// 処理完了: 内容を確定する（final あり＝編集済み / draft のみ＝編集失敗 / 空＝生成失敗）
	markEditorialFinished: (content: { draft: string | null; final: string | null }) => Promise<void>;
};

/** 導入・締めの1要素への段階書き込みハンドル */
export const narrationWriter = (topicId: string, kind: 'intro' | 'outro'): EditorialWriter => {
	const set = kind === 'intro' ? setIntro : setOutro;
	return {
		markEditorialGenerating: () => set(topicId, { status: 'generating', draft: null, final: null }),
		markEditorialEditing: async (draft) => {
			await editorialRef(topicId).update({ [`${kind}.status`]: 'editing', [`${kind}.draft`]: draft });
		},
		markEditorialFinished: ({ draft, final }) => set(topicId, { status: 'finished', draft, final })
	};
};

/** 所感1人分（sortOrder を保った）への段階書き込みハンドル */
export const impressionWriter = (
	topicId: string,
	personaId: string,
	sortOrder: number
): EditorialWriter => ({
	markEditorialGenerating: () =>
		setImpression(topicId, personaId, { sortOrder, status: 'generating', draft: null, final: null }),
	markEditorialEditing: async (draft) => {
		await editorialRef(topicId).update({
			[`impressions.${personaId}.status`]: 'editing',
			[`impressions.${personaId}.draft`]: draft
		});
	},
	markEditorialFinished: ({ draft, final }) =>
		setImpression(topicId, personaId, { sortOrder, status: 'finished', draft, final })
});
