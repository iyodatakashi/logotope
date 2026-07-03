/**
 * generatePersonas onCall のユニットテスト（Task 4.1）。
 * 生成（in-memory）後に全ペルソナ文書を batch で永続化し、共通ヘルパー
 * confirmPhaseGenerated で running→generated 限定の冪等確定を行うことを、
 * インメモリ Firestore 上で検証する。失敗時は未書込（全件 or 未書込）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirestoreMock } from '../helpers/firestore-mock.js';

const mockRunPersonaGeneration = vi.hoisted(() => vi.fn());

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

vi.mock('firebase-functions/v2/https', () => ({
	onCall: vi.fn((_opts: unknown, handler: unknown) => handler),
	HttpsError: class HttpsError extends Error {
		constructor(
			public code: string,
			message: string
		) {
			super(message);
		}
	}
}));

vi.mock('../../utils/auth.js', () => ({
	requireAuth: vi.fn()
}));

vi.mock('../../agents/persona-generator-agent.js', () => ({
	generatePersonas: mockRunPersonaGeneration
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' }
}));

import { generatePersonas } from '../../api/personas.js';

const TOPIC_ID = 'topic1';
const TITLE = 'AIと社会';
const makeRequest = (data: unknown) => ({ data, auth: { uid: 'user1' } });
const handler = generatePersonas as unknown as (req: unknown) => Promise<unknown>;
const topic = () => holder.mock!.store.get(`topics/${TOPIC_ID}`);
const persona = (id: string) => holder.mock!.store.get(`topics/${TOPIC_ID}/personas/${id}`);

const seedStakeholders = () =>
	holder.mock!.store.set(`topics/${TOPIC_ID}/stakeholders/0`, { stakeholders: ['s1'] });

const generatedPersonas = () => ({
	personas: [
		{ id: 'p1', topicId: TOPIC_ID, name: '太郎', sortOrder: 0, approved: false },
		{ id: 'p2', topicId: TOPIC_ID, name: '花子', sortOrder: 1, approved: false }
	]
});

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
});

describe('generatePersonas handler', () => {
	it('topicIdがない場合はinvalid-argumentエラーを投げる', async () => {
		await expect(handler(makeRequest({ title: TITLE }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('titleがない場合はinvalid-argumentエラーを投げる', async () => {
		await expect(handler(makeRequest({ topicId: TOPIC_ID }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('stakeholders が存在しない場合はinvalid-argumentエラーを投げる', async () => {
		await expect(handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('生成成功時にペルソナを batch 永続化し、confirmPhaseGenerated で generated を確定して {} を返す', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'personas', phaseStatus: 'running' });
		seedStakeholders();
		mockRunPersonaGeneration.mockResolvedValueOnce(generatedPersonas());

		const result = await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		expect(result).toEqual({});
		expect(persona('p1')).toMatchObject({
			name: '太郎',
			sortOrder: 0,
			approved: false,
			beliefs: [],
			createdAt: 'TS'
		});
		expect(persona('p2')).toMatchObject({ name: '花子', sortOrder: 1 });
		expect(topic()?.phase).toBe('personas');
		expect(topic()?.phaseStatus).toBe('generated');
	});

	it('承認済み事実基盤が存在すれば topicContext.factBase を生成に渡す', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'personas', phaseStatus: 'running' });
		holder.mock!.store.set(`topics/${TOPIC_ID}/factBase/0`, {
			facts: [{ statement: '確定事実', sources: [] }],
			generatedAt: { toDate: () => new Date('2026-07-03T00:00:00Z') }
		});
		seedStakeholders();
		mockRunPersonaGeneration.mockResolvedValueOnce(generatedPersonas());

		await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		const [passedTitle, , passedTopicId, topicContext] = mockRunPersonaGeneration.mock.calls[0];
		expect(passedTitle).toBe(TITLE);
		expect(passedTopicId).toBe(TOPIC_ID);
		expect(topicContext.factBase.facts).toEqual([{ statement: '確定事実', sources: [] }]);
	});

	it('事実基盤が無ければ factBase 未設定の topicContext を渡す（従来どおり動作）', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'personas', phaseStatus: 'running' });
		seedStakeholders();
		mockRunPersonaGeneration.mockResolvedValueOnce(generatedPersonas());

		await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		const [, , , topicContext] = mockRunPersonaGeneration.mock.calls[0];
		expect(topicContext.factBase).toBeUndefined();
	});

	it('phaseStatus が not_started なら generated を上書きしない（未開始ガード）', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'personas', phaseStatus: 'not_started' });
		seedStakeholders();
		mockRunPersonaGeneration.mockResolvedValueOnce(generatedPersonas());

		await handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }));

		expect(persona('p1')).toBeDefined();
		expect(topic()?.phaseStatus).toBe('not_started');
	});

	it('生成エラー時はHttpsError(internal)を投げ、ペルソナを永続化せず generated も確定しない', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'personas', phaseStatus: 'running' });
		seedStakeholders();
		mockRunPersonaGeneration.mockRejectedValueOnce(new Error('AI failed'));

		await expect(handler(makeRequest({ topicId: TOPIC_ID, title: TITLE }))).rejects.toMatchObject({
			code: 'internal'
		});
		expect(persona('p1')).toBeUndefined();
		expect(topic()?.phaseStatus).toBe('running');
	});
});
