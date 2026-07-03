/**
 * 取材の全件完了判定（Task 5.2）のユニットテスト。
 * インメモリ Firestore 上で confirmInterviewsGeneratedIfAllComplete を駆動し、
 * 件数>0 かつ全ペルソナ interview.status==='completed' かつ topic running のときだけ
 * フェーズ3を generated に冪等確定し、それ以外は no-op になることを検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' }
}));

import { confirmInterviewsGeneratedIfAllComplete } from '../../../pipeline/interviews/interview-completion.js';

const TOPIC_ID = 'topic1';
const topic = () => holder.mock!.store.get(`topics/${TOPIC_ID}`);
const setTopic = (phaseStatus: string) =>
	holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'interviews', phaseStatus });
const setPersona = (id: string, status?: string, sortOrder = 0) =>
	holder.mock!.store.set(`topics/${TOPIC_ID}/personas/${id}`, {
		sortOrder,
		...(status ? { interview: { status } } : {})
	});

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
});

describe('confirmInterviewsGeneratedIfAllComplete', () => {
	it('全ペルソナ completed かつ topic running なら generated を確定し true を返す', async () => {
		setTopic('running');
		setPersona('p1', 'completed', 0);
		setPersona('p2', 'completed', 1);

		const changed = await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID);

		expect(changed).toBe(true);
		expect(topic()?.phaseStatus).toBe('generated');
		expect(topic()?.phase).toBe('interviews');
	});

	it('1件でも error が残るときは no-op で false を返す', async () => {
		setTopic('running');
		setPersona('p1', 'completed', 0);
		setPersona('p2', 'error', 1);

		const changed = await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID);

		expect(changed).toBe(false);
		expect(topic()?.phaseStatus).toBe('running');
	});

	it('1件でも in_progress が残るときは no-op で false を返す', async () => {
		setTopic('running');
		setPersona('p1', 'completed', 0);
		setPersona('p2', 'in_progress', 1);

		const changed = await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID);

		expect(changed).toBe(false);
		expect(topic()?.phaseStatus).toBe('running');
	});

	it('interview 未設定のペルソナがあるときは no-op で false を返す', async () => {
		setTopic('running');
		setPersona('p1', 'completed', 0);
		setPersona('p2', undefined, 1);

		const changed = await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID);

		expect(changed).toBe(false);
		expect(topic()?.phaseStatus).toBe('running');
	});

	it('ペルソナ件数0のときは no-op で false を返す', async () => {
		setTopic('running');

		const changed = await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID);

		expect(changed).toBe(false);
		expect(topic()?.phaseStatus).toBe('running');
	});

	it('topic が stopped でも全件 completed なら generated に確定する', async () => {
		setTopic('stopped');
		setPersona('p1', 'completed', 0);

		const changed = await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID);

		expect(changed).toBe(true);
		expect(topic()?.phaseStatus).toBe('generated');
	});

	it('並列の多重呼び出しでも冪等（2回目以降は false）', async () => {
		setTopic('running');
		setPersona('p1', 'completed', 0);

		expect(await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID)).toBe(true);
		expect(await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID)).toBe(false);
		expect(topic()?.phaseStatus).toBe('generated');
	});
});
