/**
 * 取材の完了判定（採用基準）のユニットテスト。
 * インメモリ Firestore 上で confirmInterviewsGeneratedIfAllComplete を駆動し、
 * 採用（selected）ペルソナが1件以上ありその全員が interview.status==='completed' かつ
 * topic が running/stopped のときだけ personas フェーズを generated に冪等確定し、
 * それ以外（未完・採用0件）は no-op になることを検証する。不採用ペルソナの状態は判定に含めない。
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
	holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'personas', phaseStatus });
const setPersona = (id: string, status?: string, sortOrder = 0, selected = true) =>
	holder.mock!.store.set(`topics/${TOPIC_ID}/personas/${id}`, {
		sortOrder,
		selected,
		...(status ? { interview: { status } } : {})
	});

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
});

describe('confirmInterviewsGeneratedIfAllComplete', () => {
	it('採用ペルソナ全員 completed かつ topic running なら personas を generated 確定し true を返す', async () => {
		setTopic('running');
		setPersona('p1', 'completed', 0);
		setPersona('p2', 'completed', 1);

		const changed = await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID);

		expect(changed).toBe(true);
		expect(topic()?.phaseStatus).toBe('generated');
		expect(topic()?.phase).toBe('personas');
	});

	it('採用ペルソナに error が残るときは no-op で false を返す', async () => {
		setTopic('running');
		setPersona('p1', 'completed', 0);
		setPersona('p2', 'error', 1);

		const changed = await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID);

		expect(changed).toBe(false);
		expect(topic()?.phaseStatus).toBe('running');
	});

	it('採用ペルソナに in_progress が残るときは no-op で false を返す', async () => {
		setTopic('running');
		setPersona('p1', 'completed', 0);
		setPersona('p2', 'in_progress', 1);

		const changed = await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID);

		expect(changed).toBe(false);
		expect(topic()?.phaseStatus).toBe('running');
	});

	it('採用ペルソナに interview 未設定があるときは no-op で false を返す', async () => {
		setTopic('running');
		setPersona('p1', 'completed', 0);
		setPersona('p2', undefined, 1);

		const changed = await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID);

		expect(changed).toBe(false);
		expect(topic()?.phaseStatus).toBe('running');
	});

	it('不採用ペルソナの取材失敗は判定に含めない（採用側が揃えば generated）', async () => {
		setTopic('running');
		setPersona('p1', 'completed', 0, true);
		setPersona('p2', 'error', 1, false); // 不採用は判定から外れる

		const changed = await confirmInterviewsGeneratedIfAllComplete(TOPIC_ID);

		expect(changed).toBe(true);
		expect(topic()?.phaseStatus).toBe('generated');
	});

	it('採用0件（全員不採用）のときは generated にしない（採用0件ガード）', async () => {
		setTopic('running');
		setPersona('p1', 'completed', 0, false);
		setPersona('p2', 'completed', 1, false);

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

	it('topic が stopped でも採用全員 completed なら generated に確定する（停止からの回復）', async () => {
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
