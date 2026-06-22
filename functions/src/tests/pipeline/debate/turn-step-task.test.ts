/**
 * enqueueTurnStep: deterministic task id によるステップ enqueue の冪等化を検証する。
 * 同一 (runId, chapterId, frontierIndex) は同一 id になり、task-already-exists は成功扱いになる。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TurnStepPayload } from '../../../types/debate.types.js';

const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockTaskQueue = vi.fn(() => ({ enqueue: mockEnqueue }));
vi.mock('firebase-admin/functions', () => ({
	getFunctions: vi.fn(() => ({ taskQueue: mockTaskQueue }))
}));

import { taskKey, hashTaskId, enqueueTurnStep } from '../../../pipeline/debate/turn-step-task.js';

const payload: TurnStepPayload = {
	topicId: 't1',
	chapterIndex: 0,
	runId: 'run-A',
	stepKind: 'turn',
	expectedTurnIndex: 3
};

describe('taskKey', () => {
	it('同一 (runId, chapterId, frontierIndex) は同一の鍵文字列を返す', () => {
		const a = taskKey({ runId: 'run-A', chapterId: 'ch1', frontierIndex: 3 });
		const b = taskKey({ runId: 'run-A', chapterId: 'ch1', frontierIndex: 3 });
		expect(a).toBe(b);
	});

	it('runId を鍵に含める（再起動時の id 衝突回避）', () => {
		const a = taskKey({ runId: 'run-A', chapterId: 'ch1', frontierIndex: 3 });
		const b = taskKey({ runId: 'run-B', chapterId: 'ch1', frontierIndex: 3 });
		expect(a).not.toBe(b);
	});

	it('終端 comments は種別ベースの鍵を生成する', () => {
		const key = taskKey({ runId: 'run-A', chapterId: 'ch1', frontierIndex: 'comments' });
		expect(key).toBe('run-A:ch1:comments');
	});
});

describe('hashTaskId', () => {
	it('同一鍵は同一 id を生成する', () => {
		expect(hashTaskId('run-A:ch1:3')).toBe(hashTaskId('run-A:ch1:3'));
	});

	it('異なる鍵は異なる id を生成する', () => {
		expect(hashTaskId('run-A:ch1:3')).not.toBe(hashTaskId('run-A:ch1:4'));
	});

	it('連番プレフィックスを避けるため hash 化されている（鍵そのままではない）', () => {
		expect(hashTaskId('run-A:ch1:3')).not.toBe('run-A:ch1:3');
	});
});

describe('enqueueTurnStep', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnqueue.mockResolvedValue(undefined);
	});

	it('deterministic id（hashTaskId）を指定して enqueue する', async () => {
		const key = taskKey({ runId: 'run-A', chapterId: 'ch1', frontierIndex: 3 });
		await enqueueTurnStep(payload, key);
		expect(mockEnqueue).toHaveBeenCalledWith(
			payload,
			expect.objectContaining({ id: hashTaskId(key) })
		);
	});

	it('task-already-exists（重複）は成功扱いにして throw しない', async () => {
		mockEnqueue.mockRejectedValueOnce({ code: 'functions/task-already-exists' });
		await expect(enqueueTurnStep(payload, 'k')).resolves.toBeUndefined();
	});

	it('ALREADY_EXISTS メッセージのエラーも成功扱いにする', async () => {
		mockEnqueue.mockRejectedValueOnce(new Error('Requested entity already exists'));
		await expect(enqueueTurnStep(payload, 'k')).resolves.toBeUndefined();
	});

	it('その他のエラーは throw する', async () => {
		mockEnqueue.mockRejectedValueOnce(new Error('network failure'));
		await expect(enqueueTurnStep(payload, 'k')).rejects.toThrow('network failure');
	});
});
