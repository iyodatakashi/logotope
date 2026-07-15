/**
 * enqueuePersonaStep: deterministic task id によるステップ enqueue の冪等化を検証する。
 * 同一 (runId, stepKind[, personaId]) は同一 id になり、task-already-exists は成功扱いになる。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockTaskQueue = vi.fn(() => ({ enqueue: mockEnqueue }));
vi.mock('firebase-admin/functions', () => ({
	getFunctions: vi.fn(() => ({ taskQueue: mockTaskQueue }))
}));

import { hashTaskId } from '../../../pipeline/debate/enqueue-step.js';
import {
	personaTaskKey,
	enqueuePersonaStep,
	type PersonaStepPayload
} from '../../../pipeline/personas/enqueue-persona-step.js';

describe('personaTaskKey', () => {
	it('同一 (runId, stepKind) は同一の鍵文字列を返す', () => {
		const a = personaTaskKey({ topicId: 't1', runId: 'run-A', stepKind: 'stakeholders' });
		const b = personaTaskKey({ topicId: 't1', runId: 'run-A', stepKind: 'stakeholders' });
		expect(a).toBe(b);
		expect(a).toBe('run-A:stakeholders');
	});

	it('runId を鍵に含める（再起動時の id 衝突回避）', () => {
		const a = personaTaskKey({ topicId: 't1', runId: 'run-A', stepKind: 'personas' });
		const b = personaTaskKey({ topicId: 't1', runId: 'run-B', stepKind: 'personas' });
		expect(a).not.toBe(b);
	});

	it('interview 段は personaId まで鍵に含める（per-persona に1本）', () => {
		const a = personaTaskKey({
			topicId: 't1',
			runId: 'run-A',
			stepKind: 'interview',
			personaId: 'p1'
		});
		const b = personaTaskKey({
			topicId: 't1',
			runId: 'run-A',
			stepKind: 'interview',
			personaId: 'p2'
		});
		expect(a).toBe('run-A:interview:p1');
		expect(a).not.toBe(b);
	});
});

describe('enqueuePersonaStep', () => {
	const payload: PersonaStepPayload = { topicId: 't1', runId: 'run-A', stepKind: 'stakeholders' };

	beforeEach(() => {
		vi.clearAllMocks();
		mockEnqueue.mockResolvedValue(undefined);
	});

	it('runPersonaStep キューへ deterministic id（hashTaskId）で enqueue する', async () => {
		await enqueuePersonaStep(payload);
		expect(mockTaskQueue).toHaveBeenCalledWith(
			'locations/asia-northeast1/functions/runPersonaStep'
		);
		expect(mockEnqueue).toHaveBeenCalledWith(
			payload,
			expect.objectContaining({ id: hashTaskId(personaTaskKey(payload)) })
		);
	});

	it('task-already-exists（重複）は成功扱いにして throw しない', async () => {
		mockEnqueue.mockRejectedValueOnce({ code: 'functions/task-already-exists' });
		await expect(enqueuePersonaStep(payload)).resolves.toBeUndefined();
	});

	it('ALREADY_EXISTS メッセージのエラーも成功扱いにする', async () => {
		mockEnqueue.mockRejectedValueOnce(new Error('Requested entity already exists'));
		await expect(enqueuePersonaStep(payload)).resolves.toBeUndefined();
	});

	it('その他のエラーは throw する', async () => {
		mockEnqueue.mockRejectedValueOnce(new Error('network failure'));
		await expect(enqueuePersonaStep(payload)).rejects.toThrow('network failure');
	});
});
