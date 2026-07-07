import { generateImpression } from '../../agents/persona-agent.js';
import { generateIntro, generateOutro } from '../../agents/intro-closing-agent.js';
import { editImpression, editIntro, editOutro } from '../../agents/editor-agent.js';
import { buildDebateDigest } from '../debate/debate-digest.js';
import { getTopicContext } from '../topics/topic-context.js';
import { pipelineErrorMessage } from '../debate/utils.js';
import type { IntroClosingInput } from '../../agents/intro-closing-agent.js';
import type {
	NarrationPartForFirestore,
	ImpressionPartForFirestore
} from '../../types/editorial.types.js';
import type { DebateTurn } from '../../types/turn.types.js';
import type { Persona } from '../../types/persona.types.js';
import type { Result, PipelineError } from '../../types/common.types.js';

// 記事要素（所感・導入・締め）を「原本生成 → 整え（編集）」で1つ作る共通部品。
// 一括生成（editing-step の各ステージ）と個別再生成（regenerate-element）の双方が使う。
// LLM 呼び出しはここに閉じ、保存（部分上書き）・ループ・失敗の扱い方は呼び出し側の責務。

const MAX_PERSONA_ATTEMPTS = 3;

/**
 * 1ペルソナ分の所感を「原本生成（最大 MAX_PERSONA_ATTEMPTS 回リトライ）→ 整え」で作る。
 * 原本生成が全滅したら null（＝当該参加者は欠け）。整えに失敗しても原本を保持し final=null で返す。
 * 各失敗は握りつぶさず warn ログに残す。
 */
export const buildImpressionPart = async (
	persona: Persona,
	turns: DebateTurn[],
	personas: ReadonlyArray<Persona>,
	sortOrder: number
): Promise<ImpressionPartForFirestore | null> => {
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
	if (draft === null) return null;

	const edited = await editImpression(draft);
	if (!edited.ok) {
		console.warn('[buildImpressionPart] edit failed', {
			personaId: persona.id,
			reason: pipelineErrorMessage(edited.error)
		});
		return { sortOrder, draft, final: null };
	}
	return { sortOrder, draft, final: edited.value };
};

/**
 * 導入・締めの1要素を「原本生成 → 整え」で作る。
 * 生成失敗なら {draft:null, final:null}、整え失敗なら原本を保持し {draft, final:null} を返す（できる範囲で）。
 */
export const buildNarrationPart = async (
	kind: 'intro' | 'outro',
	input: IntroClosingInput
): Promise<NarrationPartForFirestore> => {
	const generate = kind === 'intro' ? generateIntro : generateOutro;
	const edit = kind === 'intro' ? editIntro : editOutro;

	const generated = await generate(input);
	if (!generated.ok) {
		console.warn('[buildNarrationPart] generation failed', {
			kind,
			reason: pipelineErrorMessage(generated.error)
		});
		return { draft: null, final: null };
	}
	const draft = generated.value;

	const edited = await edit(draft);
	if (!edited.ok) {
		console.warn('[buildNarrationPart] edit failed', {
			kind,
			reason: pipelineErrorMessage(edited.error)
		});
		return { draft, final: null };
	}
	return { draft, final: edited.value };
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
