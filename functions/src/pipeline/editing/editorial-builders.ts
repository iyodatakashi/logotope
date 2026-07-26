import { generateImpression } from '../../agents/persona-agent.js';
import { generateIntro, generateOutro } from '../../agents/intro-closing-agent.js';
import { editImpression, editIntro, editOutro } from '../../agents/editor-agent.js';
import { buildDebateDigest } from '../debate/debate-digest.js';
import { readDigestCache, writeDigestCache } from './digest-cache-repository.js';
import { getTopicContext } from '../topics/topic-context.js';
import { pipelineErrorMessage } from '../debate/utils.js';
import type { IntroClosingInput } from '../../agents/intro-closing-agent.js';
import type { EditorialWriter } from './editorial-repository.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Persona } from '../../types/persona.types.js';
import type { DebateDigest } from '../../types/debate-digest.types.js';
import type { Result, PipelineError } from '../../types/common.types.js';

// editorial（所感・導入・締め）を「原本生成 → 整え（編集）」で1つ作る共通部品。
// 一括生成（editing-step の各ステージ）と個別再生成（regenerate-article-element）の双方が使う。
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
	writer: EditorialWriter
): Promise<void> => {
	await writer.markEditorialGenerating();

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
		await writer.markEditorialFinished({ draft: null, final: null }); // 生成失敗
		return;
	}

	await writer.markEditorialEditing(draft);
	const edited = await editImpression(draft);
	if (!edited.ok) {
		console.warn('[buildImpressionPart] edit failed', {
			personaId: persona.id,
			reason: pipelineErrorMessage(edited.error)
		});
		await writer.markEditorialFinished({ draft, final: null }); // 編集失敗
		return;
	}
	await writer.markEditorialFinished({ draft, final: edited.value }); // 編集済み
};

/**
 * 導入・締めの1要素を「原本生成 → 整え中 → 完了」で作り、各段階を writer で部分上書きする。
 * 「生成中への切替（旧内容クリア）」は呼び出し側が重い前処理より前に済ませておく前提で、この関数は行わない
 * （R1/R4: 生成中の即時反映を前処理の前に出すため。所感の buildImpressionPart は先頭で切替を行う点と非対称）。
 * 生成失敗なら完了（空＝生成失敗）、整え失敗なら原本を保持して完了（編集失敗）、成功なら完了（編集済み）で確定する。
 */
export const buildNarrationPart = async (
	kind: 'intro' | 'outro',
	input: IntroClosingInput,
	writer: EditorialWriter
): Promise<void> => {
	const generate = kind === 'intro' ? generateIntro : generateOutro;
	const edit = kind === 'intro' ? editIntro : editOutro;

	const generated = await generate(input);
	if (!generated.ok) {
		console.warn('[buildNarrationPart] generation failed', {
			kind,
			reason: pipelineErrorMessage(generated.error)
		});
		await writer.markEditorialFinished({ draft: null, final: null }); // 生成失敗
		return;
	}
	const draft = generated.value;

	await writer.markEditorialEditing(draft);
	const edited = await edit(draft);
	if (!edited.ok) {
		console.warn('[buildNarrationPart] edit failed', {
			kind,
			reason: pipelineErrorMessage(edited.error)
		});
		await writer.markEditorialFinished({ draft, final: null }); // 編集失敗
		return;
	}
	await writer.markEditorialFinished({ draft, final: edited.value }); // 編集済み
};

/**
 * 導入・締めの生成に必要な入力（討論ダイジェスト＋トピック文脈）を構築する。
 * ダイジェストはキャッシュ優先で解決し（有れば再利用、無ければ構築して保存）、討論が変わらない限り
 * 作り直さない（R5.1, R5.2, R5.4）。初回の一括ラン（runIntroOutroStep）と個別再生成（regenerateNarration）は
 * どちらも本関数を通すため、初回ランが保存したダイジェストを以降の再生成が再利用する。無効化は
 * clearEditedArtifact 経由の clearDigestCache に一元化する（R5.3）。topicContext は軽いため毎回取得する。
 * ダイジェスト構築失敗は従来どおり伝播する。
 */
export const buildIntroOutroInput = async (
	topicId: string
): Promise<Result<IntroClosingInput, PipelineError>> => {
	const digestResult = await resolveDebateDigest(topicId);
	if (!digestResult.ok) return digestResult;
	const topicContext = await getTopicContext(topicId);
	return { ok: true, value: { digest: digestResult.value, topicContext } };
};

/**
 * 討論ダイジェストをキャッシュ優先で解決する。キャッシュヒットなら buildDebateDigest を呼ばず再利用し、
 * ミスなら構築してキャッシュへ保存する。キャッシュの read/write はベストエフォート（再構築可能なため、
 * 失敗しても生成自体は止めない・warn ログのみ）。
 */
const resolveDebateDigest = async (
	topicId: string
): Promise<Result<DebateDigest, PipelineError>> => {
	const cached = await readDigestCacheSafe(topicId);
	if (cached) return { ok: true, value: cached };

	const built = await buildDebateDigest(topicId);
	if (!built.ok) return built;

	try {
		await writeDigestCache(topicId, built.value);
	} catch (err) {
		console.warn('[buildIntroOutroInput] digest cache write failed (best-effort)', { topicId }, err);
	}
	return built;
};

/** キャッシュ読み取り。失敗は null 扱いで通常構築へフォールバックする（ベストエフォート） */
const readDigestCacheSafe = async (topicId: string): Promise<DebateDigest | null> => {
	try {
		return await readDigestCache(topicId);
	} catch (err) {
		console.warn('[buildIntroOutroInput] digest cache read failed (best-effort)', { topicId }, err);
		return null;
	}
};
