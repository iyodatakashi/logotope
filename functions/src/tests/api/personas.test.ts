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
	generatePersonas: mockRunPersonaGeneration,
	sourceTagForIndex: (index: number) => `S${index + 1}`
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

// id を持つ3件のステークホルダーを種として置く。
const seedStakeholders = () =>
	holder.mock!.store.set(`topics/${TOPIC_ID}/stakeholders/0`, {
		stakeholders: [
			{ id: 'sid-a', role: '医師' },
			{ id: 'sid-b', role: '患者' },
			{ id: 'sid-c', role: '行政' }
		]
	});

// 採用2件（sid-a, sid-b）に対応する2ペルソナ。sourceTag で由来を示す。
const generatedPersonas = (
	personas = [
		{ id: 'p1', sourceTag: 'S1', stakeholderRole: '医師', name: '太郎' },
		{ id: 'p2', sourceTag: 'S2', stakeholderRole: '患者', name: '花子' }
	]
) => ({
	ok: true,
	value: {
		personas: personas.map((persona) => ({ topicId: TOPIC_ID, approved: false, ...persona }))
	}
});

const request = (overrides: Record<string, unknown> = {}) =>
	makeRequest({
		topicId: TOPIC_ID,
		title: TITLE,
		selectedStakeholderIds: ['sid-a', 'sid-b'],
		...overrides
	});

beforeEach(() => {
	vi.clearAllMocks();
	holder.mock = createFirestoreMock();
});

describe('generatePersonas handler', () => {
	it('topicIdがない場合はinvalid-argumentエラーを投げる', async () => {
		await expect(handler(request({ topicId: undefined }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('titleがない場合はinvalid-argumentエラーを投げる', async () => {
		await expect(handler(request({ title: undefined }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('selectedStakeholderIds が空なら invalid-argument で拒否する', async () => {
		seedStakeholders();
		await expect(handler(request({ selectedStakeholderIds: [] }))).rejects.toMatchObject({
			code: 'invalid-argument'
		});
	});

	it('selectedStakeholderIds が未知 id を含むなら invalid-argument で拒否する', async () => {
		seedStakeholders();
		await expect(
			handler(request({ selectedStakeholderIds: ['sid-a', 'sid-x'] }))
		).rejects.toMatchObject({ code: 'invalid-argument' });
	});

	it('stakeholders が存在しない場合はinvalid-argumentエラーを投げる', async () => {
		await expect(handler(request())).rejects.toMatchObject({ code: 'invalid-argument' });
	});

	it('採用2件のみを生成対象に絞り込み、由来キー付きで永続して generated を確定する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'personas', phaseStatus: 'running' });
		seedStakeholders();
		mockRunPersonaGeneration.mockResolvedValueOnce(generatedPersonas());

		const result = await handler(request());

		expect(result).toEqual({});
		// エージェントへ渡す立場は採用2件のみ（順序保持）
		const [, passedStakeholders] = mockRunPersonaGeneration.mock.calls[0];
		expect(passedStakeholders.map((stakeholder: { id: string }) => stakeholder.id)).toEqual([
			'sid-a',
			'sid-b'
		]);
		// 由来キーがタグから解決される
		expect(persona('p1')).toMatchObject({ name: '太郎', stakeholderId: 'sid-a', sortOrder: 0 });
		expect(persona('p2')).toMatchObject({ name: '花子', stakeholderId: 'sid-b', sortOrder: 1 });
		// sourceTag は永続しない
		expect('sourceTag' in (persona('p1') as object)).toBe(false);
		expect(topic()?.phaseStatus).toBe('generated');
	});

	it('生成結果のタグ順が入力順とズレても sourceTag から由来を正しく解決する', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'personas', phaseStatus: 'running' });
		seedStakeholders();
		// 出力順を反転（S2 が先、S1 が後）
		mockRunPersonaGeneration.mockResolvedValueOnce(
			generatedPersonas([
				{ id: 'p2', sourceTag: 'S2', stakeholderRole: '患者', name: '花子' },
				{ id: 'p1', sourceTag: 'S1', stakeholderRole: '医師', name: '太郎' }
			])
		);

		await handler(request());

		// タグ由来なので位置がズレても正しい stakeholderId になる
		expect(persona('p1')).toMatchObject({ name: '太郎', stakeholderId: 'sid-a' });
		expect(persona('p2')).toMatchObject({ name: '花子', stakeholderId: 'sid-b' });
	});

	it('承認済み事実基盤が存在すれば topicContext.factBase を生成に渡す', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'personas', phaseStatus: 'running' });
		holder.mock!.store.set(`topics/${TOPIC_ID}/factBase/0`, {
			facts: [{ statement: '確定事実', sources: [] }],
			generatedAt: { toDate: () => new Date('2026-07-03T00:00:00Z') }
		});
		seedStakeholders();
		mockRunPersonaGeneration.mockResolvedValueOnce(generatedPersonas());

		await handler(request());

		const [passedTitle, , passedTopicId, topicContext] = mockRunPersonaGeneration.mock.calls[0];
		expect(passedTitle).toBe(TITLE);
		expect(passedTopicId).toBe(TOPIC_ID);
		expect(topicContext.factBase.facts).toEqual([{ statement: '確定事実', sources: [] }]);
	});

	it('phaseStatus が not_started なら generated を上書きしない（未開始ガード）', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'personas', phaseStatus: 'not_started' });
		seedStakeholders();
		mockRunPersonaGeneration.mockResolvedValueOnce(generatedPersonas());

		await handler(request());

		expect(persona('p1')).toBeDefined();
		expect(topic()?.phaseStatus).toBe('not_started');
	});

	it('生成エラー時はHttpsError(internal)を投げ、ペルソナを永続化せず generated も確定しない', async () => {
		holder.mock!.store.set(`topics/${TOPIC_ID}`, { phase: 'personas', phaseStatus: 'running' });
		seedStakeholders();
		mockRunPersonaGeneration.mockResolvedValueOnce({
			ok: false,
			error: { code: 'AI_API_ERROR', message: 'AI failed', retryable: true }
		});

		await expect(handler(request())).rejects.toMatchObject({ code: 'internal' });
		expect(persona('p1')).toBeUndefined();
		expect(topic()?.phaseStatus).toBe('running');
	});
});
