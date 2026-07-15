import { getFirestore } from 'firebase-admin/firestore';
import { getPersonasByTopicId } from '../personas/personas.js';
import { getDebateTurnsByTopicId } from '../debate/chapter.js';
import { pipelineErrorMessage } from '../debate/utils.js';
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
	const personas = (await getPersonasByTopicId(topicId)).filter((persona) => persona.selected);
	const sortOrder = personas.findIndex((persona) => persona.id === personaId);
	if (sortOrder < 0) throw new Error(`採用ペルソナが見つかりません: ${personaId}`);

	const turns = await getDebateTurnsByTopicId(topicId);
	await buildImpressionPart(
		personas[sortOrder],
		turns,
		personas,
		impressionWriter(topicId, personaId, sortOrder)
	);
};

/** 導入を作り直す。生成中（内容破棄）→段階を経て完了で確定する（intro のみ部分上書き） */
export const regenerateIntro = (topicId: string): Promise<void> => regenerateNarration(topicId, 'intro');

/** 締めを作り直す。生成中（内容破棄）→段階を経て完了で確定する（outro のみ部分上書き） */
export const regenerateOutro = (topicId: string): Promise<void> => regenerateNarration(topicId, 'outro');

/**
 * 導入・締め共通の再生成。ダイジェスト構築が失敗しても例外にせず、生成失敗（空）で確定する
 * （旧内容は破棄し status で可視化する・Req 5.1, 5.3。生成の成否は status＋内容で表れるため throw しない）。
 * 構築成功時は build が「生成中→整え中→完了」で段階書き込みし、成否を内容で確定する。
 */
const regenerateNarration = async (topicId: string, kind: 'intro' | 'outro'): Promise<void> => {
	const writer = narrationWriter(topicId, kind);
	const inputResult = await buildIntroOutroInput(topicId);
	if (!inputResult.ok) {
		console.warn('[regenerateNarration] digest build failed', {
			topicId,
			kind,
			error: pipelineErrorMessage(inputResult.error)
		});
		await writer.finish({ draft: null, final: null }); // 生成失敗で確定（旧内容は破棄）
		return;
	}
	await buildNarrationPart(kind, inputResult.value, writer);
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
