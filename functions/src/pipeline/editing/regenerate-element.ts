import { getFirestore } from 'firebase-admin/firestore';
import { getPersonasByTopicId } from '../personas/personas.js';
import { getDebateTurnsByTopicId } from '../debate/chapter.js';
import { setIntro, setOutro, setImpression } from './editorial-repository.js';
import { buildImpressionPart, buildNarrationPart, buildIntroOutroInput } from './element-builders.js';
import { readRawChapters, runChapterEditStep } from './editing-step.js';
import { finalizeEditingRun } from './editing-lifecycle.js';

// 記事要素1つを種別に応じて「原本生成 → 整え → 統合保存の該当項目だけを部分上書き」で作り直すコア関数群。
// 対象要素以外は変更しない。原本生成・編集(整え)のいずれが失敗しても例外送出し、部分保存はしない
// （成功時のみ編集後 final を確定・Req 4.2, 4.3, 4.4）。一括生成のベストエフォート（原本のみ保存）とは異なる。
// 編集が確定済み（generated/stopped）であることは呼び出し側（共通入口）がゲートする。

const db = () => getFirestore();

/** 所感1人分を作り直す。原本生成→整え→setImpression（当該ペルソナのみ部分上書き。編集後が無ければ例外） */
export const regenerateImpression = async (topicId: string, personaId: string): Promise<void> => {
	const personas = (await getPersonasByTopicId(topicId)).filter((persona) => persona.approved);
	const sortOrder = personas.findIndex((persona) => persona.id === personaId);
	if (sortOrder < 0) throw new Error(`承認済みペルソナが見つかりません: ${personaId}`);

	const turns = await getDebateTurnsByTopicId(topicId);
	const part = await buildImpressionPart(personas[sortOrder], turns, personas, sortOrder);
	if (part === null || part.final === null) throw new Error(`所感の再生成に失敗しました: ${personaId}`);
	await setImpression(topicId, personaId, part);
};

/** 導入を作り直す。原本生成→整え→setIntro（intro のみ部分上書き。編集後が無ければ例外） */
export const regenerateIntro = async (topicId: string): Promise<void> => {
	const inputResult = await buildIntroOutroInput(topicId);
	if (!inputResult.ok) throw new Error('討論ダイジェストの構築に失敗しました');
	const part = await buildNarrationPart('intro', inputResult.value);
	if (part.final === null) throw new Error('導入の再生成に失敗しました');
	await setIntro(topicId, part);
};

/** 締めを作り直す。原本生成→整え→setOutro（outro のみ部分上書き。編集後が無ければ例外） */
export const regenerateOutro = async (topicId: string): Promise<void> => {
	const inputResult = await buildIntroOutroInput(topicId);
	if (!inputResult.ok) throw new Error('討論ダイジェストの構築に失敗しました');
	const part = await buildNarrationPart('outro', inputResult.value);
	if (part.final === null) throw new Error('締めの再生成に失敗しました');
	await setOutro(topicId, part);
};

/**
 * 章1つを再編集して editedChapters を更新し、現行 runId で編集全体の完了状態を再評価する（Req 4.5）。
 * 全章が completed に転じれば finalizeEditingRun が stopped→generated へ更新する。
 * 再編集が completed にならなければ（構造検証不合格・原本欠落）例外を送出する。
 */
export const regenerateChapter = async (topicId: string, chapterId: string): Promise<void> => {
	const chapters = await readRawChapters(topicId);
	const index = chapters.findIndex((chapter) => chapter.id === chapterId);
	if (index < 0) throw new Error(`章が見つかりません: ${chapterId}`);

	const status = await runChapterEditStep(topicId, index, '');

	const snap = await db().doc(`topics/${topicId}`).get();
	const runId = (snap.data() as { runId?: string } | undefined)?.runId;
	if (runId) await finalizeEditingRun(topicId, runId);

	if (status !== 'completed') throw new Error(`章の再編集に失敗しました: ${chapterId}`);
};
