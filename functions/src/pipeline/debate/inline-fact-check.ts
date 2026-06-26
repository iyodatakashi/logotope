import { checkContent } from '../fact-check/fact-check-runner.js';
import { generateTurn } from '../../agents/persona-agent.js';
import { INLINE_FACT_CHECK_TIMEOUT_MS } from '../../constants/debate.constants.js';
import type { PersonaReply, Engagement } from '../../types/debate.types.js';
import type { Persona } from '../../types/persona.types.js';
import type {
	TurnGenerationContext,
	TurnFactCheckTrace,
	TurnFactCheckFeedback
} from '../../types/turn.types.js';
import type { FactCheckContext } from '../../types/fact-check.types.js';

type VerifyAndReviseInput = {
	draft: PersonaReply;
	persona: Persona;
	context: TurnGenerationContext;
	factCheckContext: FactCheckContext;
	engagement: Engagement;
	personas: ReadonlyArray<Persona>;
};

export type VerifyAndReviseResult = {
	reply: PersonaReply; // 採用する発言（原ドラフト or 再生成）
	trace: TurnFactCheckTrace;
};

const TIMEOUT = Symbol('inline-fact-check-timeout');

/**
 * ドラフト発言を検証コアで検証し、修正対象の指摘があれば1回だけ再生成して採用する（3, 6）。
 * 検証は最大1巡・再生成は最大1回・再生成後の再検証はしない。コミット（addTurn）は行わず、
 * 採用 reply と補正トレースを返すのみ。例外は呼び出し元へ伝播させず常にフォールバックで解決する。
 */
export const verifyAndReviseDraft = async (
	input: VerifyAndReviseInput
): Promise<VerifyAndReviseResult> => {
	const { draft, persona, context, factCheckContext, engagement, personas } = input;

	// 検証エラー・タイムアウト時は未補正で採用（フォールバック・6.1/6.3）
	const unverified: VerifyAndReviseResult = {
		reply: draft,
		trace: { status: 'unverified', revised: false, findings: [] }
	};

	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
			timeoutHandle = setTimeout(() => resolve(TIMEOUT), INLINE_FACT_CHECK_TIMEOUT_MS);
		});
		const verifyResult = await Promise.race([
			checkContent(
				{
					content: draft.content,
					speechMode: draft.speechMode,
					speakerType: 'persona',
					logId: persona.id
				},
				factCheckContext
			),
			timeoutPromise
		]);

		if (verifyResult === TIMEOUT || !verifyResult.ok) {
			console.warn('[verifyAndReviseDraft] verification failed; adopting draft unverified', {
				personaId: persona.id,
				chapterId: context.chapter.id,
				reason: verifyResult === TIMEOUT ? 'timeout' : verifyResult.error.code
			});
			return unverified;
		}

		const findings = verifyResult.value;
		// 修正対象の指摘なし → ドラフトをそのまま採用（2.5）
		if (findings.length === 0) {
			return { reply: draft, trace: { status: 'checked', revised: false, findings: [] } };
		}

		// 指摘あり → フィードバックを載せ替えて1回だけ再生成（3.1〜3.4）
		const factCheckFeedback: TurnFactCheckFeedback = findings.map((finding) => ({
			claim: finding.claim,
			verdict: finding.verdict,
			correction: finding.correction,
			reason: finding.reason
		}));
		const regenerated = await generateTurn(
			persona,
			{ ...context, factCheckFeedback },
			engagement,
			personas
		);

		// 再生成エラー → 補正を断念し原ドラフトを採用（指摘は記録・6.4）
		if (!regenerated.ok) {
			console.warn('[verifyAndReviseDraft] regeneration failed; adopting draft with findings', {
				personaId: persona.id,
				chapterId: context.chapter.id
			});
			return { reply: draft, trace: { status: 'checked', revised: false, findings } };
		}

		return {
			reply: regenerated.value,
			trace: { status: 'checked', revised: true, findings, originalContent: draft.content }
		};
	} catch (err) {
		console.warn('[verifyAndReviseDraft] unexpected error; adopting draft unverified', {
			personaId: persona.id,
			chapterId: context.chapter.id,
			err
		});
		return unverified;
	} finally {
		if (timeoutHandle) clearTimeout(timeoutHandle);
	}
};
