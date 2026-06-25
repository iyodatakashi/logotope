import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { createFirestoreMock } from '../../helpers/firestore-mock.js';
import type { FactCheckFinding } from '../../../types/fact-check.types.js';

const { holder } = vi.hoisted(() => ({
	holder: {
		mock: undefined as
			| ReturnType<(typeof import('../../helpers/firestore-mock.js'))['createFirestoreMock']>
			| undefined
	}
}));

vi.mock('firebase-admin/firestore', () => ({
	getFirestore: () => holder.mock!.firestore,
	Timestamp: { now: () => 'TS' },
	FieldValue: {
		delete: () => holder.mock!.FieldValue.delete(),
		arrayUnion: (...v: unknown[]) => holder.mock!.FieldValue.arrayUnion(...v)
	}
}));

import {
	startFactCheckResult,
	appendFactCheckFindings,
	markFactCheckCompleted,
	failFactCheckResult,
	readFactCheckResult,
	deleteFactCheckResult
} from '../../../pipeline/fact-check/fact-check-repository.js';

const PATH = 'topics/t1/chapters/c1/factCheck/result';

const makeFinding = (id: string): FactCheckFinding => ({
	id,
	turnId: 'turn1',
	speakerType: 'persona',
	claim: '誤った主張',
	verdict: 'incorrect',
	correction: '正しい事実',
	reason: '理由',
	sources: [{ title: 'https://example.com', url: 'https://example.com' }]
});

beforeEach(() => {
	holder.mock = createFirestoreMock();
});

describe('startFactCheckResult', () => {
	it('running 状態を startedAt 付きで書き込む', async () => {
		await startFactCheckResult('t1', 'c1');
		const doc = holder.mock!.store.get(PATH);
		expect(doc).toMatchObject({
			chapterId: 'c1',
			status: 'running',
			findings: [],
			sources: [],
			startedAt: 'TS'
		});
	});

	it('実行開始時に既存の結果を削除してから running を書く', async () => {
		holder.mock!.store.set(PATH, {
			chapterId: 'c1',
			status: 'completed',
			findings: [makeFinding('f1')],
			sources: [],
			startedAt: 'OLD',
			completedAt: 'OLD',
			errorMessage: 'old error'
		});
		await startFactCheckResult('t1', 'c1');
		const doc = holder.mock!.store.get(PATH);
		expect(doc!.status).toBe('running');
		expect(doc!.findings).toEqual([]);
		expect(doc!.completedAt).toBeUndefined();
		expect(doc!.errorMessage).toBeUndefined();
	});
});

describe('appendFactCheckFindings', () => {
	it('findings・sources を逐次追記する（running のまま、完了を待たない）', async () => {
		await startFactCheckResult('t1', 'c1');
		await appendFactCheckFindings(
			't1',
			'c1',
			[makeFinding('f1')],
			[{ title: 'https://a.com', url: 'https://a.com' }]
		);
		const doc1 = holder.mock!.store.get(PATH);
		expect(doc1!.status).toBe('running');
		expect((doc1!.findings as unknown[]).map((f) => (f as FactCheckFinding).id)).toEqual(['f1']);

		await appendFactCheckFindings(
			't1',
			'c1',
			[makeFinding('f2')],
			[{ title: 'https://b.com', url: 'https://b.com' }]
		);
		const doc2 = holder.mock!.store.get(PATH);
		expect((doc2!.findings as unknown[]).map((f) => (f as FactCheckFinding).id)).toEqual([
			'f1',
			'f2'
		]);
		expect(doc2!.sources).toHaveLength(2);
	});

	it('findings・sources が空なら書き込まない', async () => {
		await startFactCheckResult('t1', 'c1');
		await appendFactCheckFindings('t1', 'c1', [], []);
		const doc = holder.mock!.store.get(PATH);
		expect(doc!.findings).toEqual([]);
	});
});

describe('markFactCheckCompleted', () => {
	it('completed と completedAt を書き、追記済み findings を保持する', async () => {
		await startFactCheckResult('t1', 'c1');
		await appendFactCheckFindings('t1', 'c1', [makeFinding('f1')], []);
		await markFactCheckCompleted('t1', 'c1');
		const doc = holder.mock!.store.get(PATH);
		expect(doc!.status).toBe('completed');
		expect(doc!.completedAt).toBe('TS');
		expect((doc!.findings as unknown[]).map((f) => (f as FactCheckFinding).id)).toEqual(['f1']);
		expect(doc!.startedAt).toBe('TS');
	});
});

describe('failFactCheckResult', () => {
	it('failed と errorMessage を記録する', async () => {
		await startFactCheckResult('t1', 'c1');
		await failFactCheckResult('t1', 'c1', '検証に失敗しました');
		const doc = holder.mock!.store.get(PATH);
		expect(doc!.status).toBe('failed');
		expect(doc!.errorMessage).toBe('検証に失敗しました');
	});
});

describe('readFactCheckResult', () => {
	it('存在する結果を返す', async () => {
		await startFactCheckResult('t1', 'c1');
		const result = await readFactCheckResult('t1', 'c1');
		expect(result?.status).toBe('running');
		expect(result?.chapterId).toBe('c1');
	});

	it('存在しなければ null を返す', async () => {
		const result = await readFactCheckResult('t1', 'missing');
		expect(result).toBeNull();
	});
});

describe('deleteFactCheckResult', () => {
	it('結果ドキュメントを削除する', async () => {
		await startFactCheckResult('t1', 'c1');
		await deleteFactCheckResult('t1', 'c1');
		expect(holder.mock!.store.has(PATH)).toBe(false);
	});
});
