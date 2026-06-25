import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type {
	FactCheckStatus,
	FactCheckVerdict,
	FactCheckFinding,
	FactCheckResultForFirestore,
	FactCheckResult
} from '$lib/models/factCheck/factCheck.types';

describe('factCheck.types', () => {
	it('FactCheckFinding が引用・正しい事実・理由・出典を持つ', () => {
		const finding: FactCheckFinding = {
			id: 'f1',
			turnId: 't1',
			speakerType: 'facilitator',
			claim: '誤った主張',
			verdict: 'incorrect',
			correction: '正しい事実',
			reason: '理由',
			sources: [{ title: 'タイトル', url: 'https://example.com' }]
		};
		expect(finding.turnId).toBe('t1');
		expect(finding.sources[0].url).toBe('https://example.com');
	});

	it('FactCheckVerdict は incorrect / unverifiable', () => {
		const verdicts: FactCheckVerdict[] = ['incorrect', 'unverifiable'];
		expect(verdicts).toHaveLength(2);
	});

	it('FactCheckStatus は running / completed / failed', () => {
		const statuses: FactCheckStatus[] = ['running', 'completed', 'failed'];
		expect(statuses).toHaveLength(3);
	});

	it('FactCheckResultForFirestore は Timestamp を持つ永続型', () => {
		const result: FactCheckResultForFirestore = {
			chapterId: 'c1',
			status: 'completed',
			findings: [],
			sources: [],
			startedAt: Timestamp.fromDate(new Date()),
			completedAt: Timestamp.fromDate(new Date())
		};
		expect(result.startedAt).toBeInstanceOf(Timestamp);
	});

	it('FactCheckResult は Date に変換後のフロント型', () => {
		const result: FactCheckResult = {
			chapterId: 'c1',
			status: 'running',
			findings: [],
			sources: [],
			startedAt: new Date()
		};
		expect(result.startedAt).toBeInstanceOf(Date);
		expect(result.completedAt).toBeUndefined();
	});
});
