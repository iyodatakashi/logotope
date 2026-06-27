/**
 * サーバ共通のフェーズ状態ヘルパー（Task 1.1）のユニットテスト。
 * インメモリ Firestore 上で confirmPhaseGenerated / setTopicPhaseStatus を直接駆動し、
 * running→generated 限定の冪等遷移と、running/stopped のみ書ける状態書込を検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../helpers/firestore-mock.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' }
}));

import { confirmPhaseGenerated, setTopicPhaseStatus } from '../../utils/topic-phase.js';

const TOPIC_ID = 'topic1';
const topic = () => holder.mock!.store.get(`topics/${TOPIC_ID}`);

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
});

describe('confirmPhaseGenerated', () => {
	it('phaseStatus が running のときだけ generated へ遷移し true を返す', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 2, phaseStatus: 'running' });

		const changed = await confirmPhaseGenerated(TOPIC_ID, 2);

		expect(changed).toBe(true);
		expect(topic()?.phaseStatus).toBe('generated');
		expect(topic()?.phase).toBe(2);
	});

	it('冪等: 既に generated なら no-op で false を返す', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 2, phaseStatus: 'generated' });

		const changed = await confirmPhaseGenerated(TOPIC_ID, 2);

		expect(changed).toBe(false);
		expect(topic()?.phaseStatus).toBe('generated');
	});

	it('stopped は上書きしない（no-op・false）', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 2, phaseStatus: 'stopped' });

		const changed = await confirmPhaseGenerated(TOPIC_ID, 2);

		expect(changed).toBe(false);
		expect(topic()?.phaseStatus).toBe('stopped');
	});

	it('承認済み（phase 前進・not_started 相当）など running 以外は上書きしない', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 3, phaseStatus: 'not_started' });

		const changed = await confirmPhaseGenerated(TOPIC_ID, 2);

		expect(changed).toBe(false);
		expect(topic()?.phaseStatus).toBe('not_started');
		expect(topic()?.phase).toBe(3);
	});

	it('ドキュメント不存在時は no-op で false を返す', async () => {
		const changed = await confirmPhaseGenerated(TOPIC_ID, 2);

		expect(changed).toBe(false);
		expect(topic()).toBeUndefined();
	});

	it('複数回適用しても結果が変わらない（冪等・終端）', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 4, phaseStatus: 'running' });

		expect(await confirmPhaseGenerated(TOPIC_ID, 4)).toBe(true);
		expect(await confirmPhaseGenerated(TOPIC_ID, 4)).toBe(false);
		expect(await confirmPhaseGenerated(TOPIC_ID, 4)).toBe(false);
		expect(topic()?.phaseStatus).toBe('generated');
	});
});

describe('setTopicPhaseStatus', () => {
	it('running を phase 付きで書き込む', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 0, phaseStatus: 'not_started' });

		await setTopicPhaseStatus(TOPIC_ID, 2, 'running');

		expect(topic()?.phase).toBe(2);
		expect(topic()?.phaseStatus).toBe('running');
		expect(topic()?.updatedAt).toBe('TS');
	});

	it('stopped を書き込む', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 2, phaseStatus: 'running' });

		await setTopicPhaseStatus(TOPIC_ID, 2, 'stopped');

		expect(topic()?.phaseStatus).toBe('stopped');
	});
});
