import { generateImpression } from '../../agents/persona-agent.js';
import { generateIntro, generateOutro } from '../../agents/intro-closing-agent.js';
import { editImpression, editIntro, editOutro } from '../../agents/editor-agent.js';
import { buildDebateDigest } from '../debate/debate-digest.js';
import { getTopicContext } from '../topics/topic-context.js';
import { pipelineErrorMessage } from '../debate/utils.js';
import type { IntroClosingInput } from '../../agents/intro-closing-agent.js';
import type { ElementWriter } from './editorial-repository.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Persona } from '../../types/persona.types.js';
import type { Result, PipelineError } from '../../types/common.types.js';

// 記事要素（所感・導入・締め）を「原本生成 → 整え（編集）」で1つ作る共通部品。
// 一括生成（editing-step の各ステージ）と個別再生成（regenerate-element）の双方が使う。
// LLM 呼び出しはここに閉じ、進行に合わせた status＋内容の段階書き込みは writer に委ねる（呼び出し側が対象要素を渡す）。
// 生成・整えの失敗は例外にせず finished で確定する（ベストエフォート。他要素・本文を止めない）。

const MAX_PERSONA_ATTEMPTS = 3;

/**
 * 1ペルソナ分の所感を「生成中 → 原本生成（最大 MAX_PERSONA_ATTEMPTS 回リトライ）→ 整え中 → 完了」で作り、
 * 各段階を writer で部分上書きする。原本生成が全滅なら完了（空＝生成失敗）、整え失敗なら完了（原本のみ＝編集失敗）、
 * 成功なら完了（編集済み）で確定する。各失敗は握りつぶさず warn ログに残す。
 */
export const buildImpressionPart = async (
	persona: Persona,
	turns: DebateTurn[],
	personas: ReadonlyArray<Persona>,
	writer: ElementWriter
): Promise<void> => {
	await writer.begin();

	let draft: string | null = null;
	for (let attempt = 1; attempt <= MAX_PERSONA_ATTEMPTS; attempt++) {
		const result = await generateImpression(persona, turns, personas);
		if (result.ok) {
			draft = result.value.content;
			break;
		}
		console.warn('[buildImpressionPart] generation attempt failed', {
			personaId: persona.id,
			attempt,
			reason: pipelineErrorMessage(result.error)
		});
	}
	if (draft === null) {
		await writer.finish({ draft: null, final: null }); // 生成失敗
		return;
	}

	await writer.toEditing(draft);
	const edited = await editImpression(draft);
	if (!edited.ok) {
		console.warn('[buildImpressionPart] edit failed', {
			personaId: persona.id,
			reason: pipelineErrorMessage(edited.error)
		});
		await writer.finish({ draft, final: null }); // 編集失敗
		return;
	}
	await writer.finish({ draft, final: edited.value }); // 編集済み
};

/**
 * 導入・締めの1要素を「生成中 → 原本生成 → 整え中 → 完了」で作り、各段階を writer で部分上書きする。
 * 生成失敗なら完了（空＝生成失敗）、整え失敗なら原本を保持して完了（編集失敗）、成功なら完了（編集済み）で確定する。
 */
export const buildNarrationPart = async (
	kind: 'intro' | 'outro',
	input: IntroClosingInput,
	writer: ElementWriter
): Promise<void> => {
	const generate = kind === 'intro' ? generateIntro : generateOutro;
	const edit = kind === 'intro' ? editIntro : editOutro;

	await writer.begin();

	const generated = await generate(input);
	if (!generated.ok) {
		console.warn('[buildNarrationPart] generation failed', {
			kind,
			reason: pipelineErrorMessage(generated.error)
		});
		await writer.finish({ draft: null, final: null }); // 生成失敗
		return;
	}
	const draft = generated.value;

	await writer.toEditing(draft);
	const edited = await edit(draft);
	if (!edited.ok) {
		console.warn('[buildNarrationPart] edit failed', {
			kind,
			reason: pipelineErrorMessage(edited.error)
		});
		await writer.finish({ draft, final: null }); // 編集失敗
		return;
	}
	await writer.finish({ draft, final: edited.value }); // 編集済み
};

/** 導入・締めの生成に必要な入力（討論ダイジェスト＋トピック文脈）を構築する。ダイジェスト失敗は伝播 */
export const buildIntroOutroInput = async (
	topicId: string
): Promise<Result<IntroClosingInput, PipelineError>> => {
	const digestResult = await buildDebateDigest(topicId);
	if (!digestResult.ok) return digestResult;
	const topicContext = await getTopicContext(topicId);
	return { ok: true, value: { digest: digestResult.value, topicContext } };
};
