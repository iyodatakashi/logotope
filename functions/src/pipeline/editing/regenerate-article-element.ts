import { getFirestore } from 'firebase-admin/firestore';
import { getPersonasByTopicId } from '../personas/personas.js';
import { getDebateTurnsByTopicId } from '../debate/chapter.js';
import { pipelineErrorMessage } from '../debate/utils.js';
import { narrationWriter, impressionWriter } from './editorial-repository.js';
import { buildImpressionPart, buildNarrationPart, buildIntroOutroInput } from './editorial-builders.js';
import { readRawChapters, runChapterEditStep } from './editing-step.js';
import { finalizeEditingRun } from './editing-lifecycle.js';

// ArticleElement（章／導入／締め／所感）1つを種別に応じて作り直すコア関数群。対象要素以外は変更しない。
// 開始時に既存内容を破棄して生成中にし（再生成の意図を即時反映・Req 1.1, 1.2）、段階を経て完了で確定する。
// 導入・締めは「生成中への切替」を重い前処理（ダイジェスト）より前に出す（呼び出し側の責務・Req 4.1, 4.2）。
// 生成できれば編集済み／編集失敗、生成失敗なら空（生成失敗）で確定し旧内容は保持しない（専用の
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
 * 導入・締め共通の再生成。まず「生成中への切替（旧内容クリア）」を単一書き込み・非トランザクションで行い、
 * 重い前処理（ダイジェスト入力構築）より前に生成中を即時反映する（Req 1.1, 1.2, 2.1, 2.2, 4.1, 4.2）。
 * その後の前処理が失敗しても例外にせず、生成失敗（空）で終端に確定して「生成中」で固着させない（Req 3.1）。
 * 構築成功時は build が「整え中→完了」で段階書き込みし、成否を内容で確定する（切替は済み前提）。
 */
const regenerateNarration = async (topicId: string, kind: 'intro' | 'outro'): Promise<void> => {
	const writer = narrationWriter(topicId, kind);
	await writer.markEditorialGenerating(); // 生成中へ即時切替（旧内容クリア）を重い前処理より先に出す

	const inputResult = await buildIntroOutroInput(topicId);
	if (!inputResult.ok) {
		console.warn('[regenerateNarration] digest build failed', {
			topicId,
			kind,
			error: pipelineErrorMessage(inputResult.error)
		});
		await writer.markEditorialFinished({ draft: null, final: null }); // 生成失敗で終端に確定
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
