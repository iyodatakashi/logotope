import { createHash } from 'node:crypto';
import { getFunctions } from 'firebase-admin/functions';
import type { StepPayload } from '../../types/step.types.js';

const REGION = 'asia-northeast1';

/**
 * deterministic task id の鍵。frontierIndex = 投入先ステップの章ローカル期待位置。
 * 終端 comments は index を持たないため種別ベースの鍵にする。runId を含めて再起動時の衝突を避ける。
 */
export const taskKey = (p: {
	runId: string;
	chapterId: string;
	frontierIndex: number | 'comments';
}): string => `${p.runId}:${p.chapterId}:${p.frontierIndex}`;

/** 連番プレフィックスはレイテンシ悪化のため鍵を hash 化して task id にする（SDK 推奨） */
export const hashTaskId = (key: string): string =>
	createHash('sha256').update(key).digest('hex').slice(0, 40);

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

/**
 * per-turn ステップを deterministic id で enqueue する。
 * 同一 id のタスクが既存/最近実行済みなら task-already-exists を catch して成功扱いにし、
 * resume の多重投入を1本へ収束させる。
 */
export const enqueueStep = async (payload: StepPayload, key: string): Promise<void> => {
	const queue = getFunctions().taskQueue(`locations/${REGION}/functions/runStep`);
	try {
		await queue.enqueue(payload, { id: hashTaskId(key), scheduleDelaySeconds: 0 });
	} catch (err) {
		if (isTaskAlreadyExists(err)) return;
		throw err;
	}
};
