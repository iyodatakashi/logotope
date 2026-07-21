import { getFunctions } from 'firebase-admin/functions';
import { hashTaskId } from '../debate/enqueue-step.js';

// ペルソナ生成チェーンの「1ステップ＝1 Cloud Task」投入層。討論・編集の enqueue と同型で、
// deterministic なタスク id により resume の多重投入を1本へ収束させる。

const REGION = 'asia-northeast1';

export type PersonaStepKind = 'stakeholders' | 'personas' | 'interview';

export type PersonaStepPayload = {
	topicId: string;
	runId: string;
	stepKind: PersonaStepKind;
	// interview 段のみ必須（per-persona に並列 enqueue するため）。
	personaId?: string;
};

/**
 * deterministic task id の鍵。runId と段で一意にし、再起動時の衝突を避ける。
 * interview 段はペルソナごとに1本走るため personaId まで含める。
 */
export const personaTaskKey = (payload: PersonaStepPayload): string =>
	payload.stepKind === 'interview'
		? `${payload.runId}:${payload.stepKind}:${payload.personaId}`
		: `${payload.runId}:${payload.stepKind}`;

/** Cloud Tasks の重複作成シグナル（ALREADY_EXISTS / 409）を判定する */
const isTaskAlreadyExists = (err: unknown): boolean => {
	const code = (err as { code?: string | number })?.code;
	const message = (err as { message?: string })?.message ?? '';
	return (
		code === 'functions/task-already-exists' ||
		code === 6 ||
		code === 409 ||
		/already.?exists/i.test(message)
	);
};

/** ペルソナ生成ステップを deterministic id で enqueue する。既存/最近実行済みは成功扱いにする */
export const enqueuePersonaStep = async (payload: PersonaStepPayload): Promise<void> => {
	const queue = getFunctions().taskQueue(`locations/${REGION}/functions/runPersonaStep`);
	try {
		await queue.enqueue(payload, {
			id: hashTaskId(personaTaskKey(payload)),
			scheduleDelaySeconds: 0
		});
	} catch (err) {
		if (isTaskAlreadyExists(err)) return;
		throw err;
	}
};
