import { getFirestore } from 'firebase-admin/firestore';
import { getPersonasByTopicId } from '../personas/personas.js';
import { getDebateTurnsByTopicId } from '../debate/chapter.js';
import { narrationWriter, impressionWriter } from './editorial-repository.js';
import { buildImpressionPart, buildNarrationPart, buildIntroOutroInput } from './element-builders.js';
import { readRawChapters, runChapterEditStep } from './editing-step.js';
import { finalizeEditingRun } from './editing-lifecycle.js';

// 記事要素1つを種別に応じて build（段階書き込み）で作り直すコア関数群。対象要素以外は変更しない。
// build 開始時に既存内容を破棄して生成中にし（再生成の意図を即時反映・Req 5.1）、段階を経て完了で確定する。
// 生成できれば編集済み／編集失敗、生成失敗なら空（生成失敗）で確定し旧内容は保持しない（Req 5.2, 5.3。専用の
// regenerating 状態は作らず generating を再利用）。編集が確定済み（generated/stopped）は呼び出し側がゲートする。

const db = () => getFirestore();

/** 所感1人分を作り直す。生成中（内容破棄）→段階を経て完了で確定する（当該ペルソナのみ部分上書き） */
export const regenerateImpression = async (topicId: string, personaId: string): Promise<void> => {
	const personas = (await getPersonasByTopicId(topicId)).filter((persona) => persona.approved);
	const sortOrder = personas.findIndex((persona) => persona.id === personaId);
	if (sortOrder < 0) throw new Error(`承認済みペルソナが見つかりません: ${personaId}`);

	const turns = await getDebateTurnsByTopicId(topicId);
	await buildImpressionPart(
		personas[sortOrder],
		turns,
		personas,
		impressionWriter(topicId, personaId, sortOrder)
	);
};

/** 導入を作り直す。生成中（内容破棄）→段階を経て完了で確定する（intro のみ部分上書き） */
export const regenerateIntro = async (topicId: string): Promise<void> => {
	const inputResult = await buildIntroOutroInput(topicId);
	if (!inputResult.ok) throw new Error('討論ダイジェストの構築に失敗しました');
	await buildNarrationPart('intro', inputResult.value, narrationWriter(topicId, 'intro'));
};

/** 締めを作り直す。生成中（内容破棄）→段階を経て完了で確定する（outro のみ部分上書き） */
export const regenerateOutro = async (topicId: string): Promise<void> => {
	const inputResult = await buildIntroOutroInput(topicId);
	if (!inputResult.ok) throw new Error('討論ダイジェストの構築に失敗しました');
	await buildNarrationPart('outro', inputResult.value, narrationWriter(topicId, 'outro'));
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
