import { getFunctions } from 'firebase-admin/functions';
import { hashTaskId } from '../debate/enqueue-step.js';

// 編集チェーンの「1ステップ＝1 Cloud Task」投入層。討論の enqueue-step と同型で、
// deterministic なタスク id により resume の多重投入を1本へ収束させる。

const REGION = 'asia-northeast1';

export type EditingStepPayload = {
	topicId: string;
	runId: string;
	stepKind: 'chapter' | 'comments';
	chapterIndex: number;
};

/** deterministic task id の鍵。runId を含めて再起動時の衝突を避ける。comments は index -1 固定 */
export const editingTaskKey = (payload: EditingStepPayload): string =>
	`${payload.runId}:${payload.stepKind}:${payload.chapterIndex}`;

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

/** 編集ステップを deterministic id で enqueue する。既存/最近実行済みは成功扱いにする */
export const enqueueEditingStep = async (payload: EditingStepPayload): Promise<void> => {
	const queue = getFunctions().taskQueue(`locations/${REGION}/functions/runEditingStep`);
	try {
		await queue.enqueue(payload, {
			id: hashTaskId(editingTaskKey(payload)),
			scheduleDelaySeconds: 0
		});
	} catch (err) {
		if (isTaskAlreadyExists(err)) return;
		throw err;
	}
};
