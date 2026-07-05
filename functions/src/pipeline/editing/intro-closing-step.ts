import { buildDebateDigest } from '../debate/debate-digest.js';
import { getTopicContext } from '../topics/topic-context.js';
import { generateIntro, generateClosing } from '../../agents/intro-closing-agent.js';
import { writeEditedIntroClosing } from './edited-repository.js';
import { pipelineErrorMessage } from '../debate/utils.js';

// intro-closing ステップ本体。討論ダイジェスト → イントロ・クロージングを独立生成 → 成果物保存を
// best-effort で実行する。ダイジェスト失敗時は両方 null、片方の生成失敗時は成功側を保持し失敗側を null。
// 生成・ダイジェストの失敗は例外にせずログのみとし、ステップは必ず正常終了する（後続ステップ・完了確定を
// 妨げない・R7.1, R7.3）。原本は読み取りのみ・不変。状態は Firestore から再構築するため冪等（上書き）。

export const runIntroClosingStep = async (topicId: string, runId: string): Promise<void> => {
	try {
		const digestResult = await buildDebateDigest(topicId);
		if (!digestResult.ok) {
			console.warn('[runIntroClosingStep] digest build failed', {
				topicId,
				runId,
				error: pipelineErrorMessage(digestResult.error)
			});
			await writeEditedIntroClosing(topicId, { intro: null, closing: null });
			return;
		}

		const topicContext = await getTopicContext(topicId);
		const input = { digest: digestResult.value, topicContext };

		const [introResult, closingResult] = await Promise.all([
			generateIntro(input),
			generateClosing(input)
		]);

		const intro = introResult.ok ? introResult.value : null;
		const closing = closingResult.ok ? closingResult.value : null;
		if (!introResult.ok) {
			console.warn('[runIntroClosingStep] intro generation failed', {
				topicId,
				runId,
				error: pipelineErrorMessage(introResult.error)
			});
		}
		if (!closingResult.ok) {
			console.warn('[runIntroClosingStep] closing generation failed', {
				topicId,
				runId,
				error: pipelineErrorMessage(closingResult.error)
			});
		}
		if (introResult.ok && closingResult.ok) {
			console.info('[runIntroClosingStep] intro/closing generated', { topicId, runId });
		}

		await writeEditedIntroClosing(topicId, { intro, closing });
	} catch (err) {
		// best-effort: 予期せぬ例外でも後続ステップ・完了確定を妨げないため握りつぶす（原本は不変）。
		console.warn('[runIntroClosingStep] unexpected error (best-effort)', { topicId, runId }, err);
		try {
			await writeEditedIntroClosing(topicId, { intro: null, closing: null });
		} catch (writeErr) {
			console.warn(
				'[runIntroClosingStep] failed to write null artifact',
				{ topicId, runId },
				writeErr
			);
		}
	}
};
