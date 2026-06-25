import { describe, it, expect } from 'vitest';
import type { Timestamp } from 'firebase-admin/firestore';
import type {
	FactCheckStatus,
	FactCheckVerdict,
	FactCheckFinding,
	FactCheckResultForFirestore
} from '../../types/fact-check.types.js';

describe('fact-check.types', () => {
	it('FactCheckFinding が対象発言・引用・正しい事実・理由・出典を持つ', () => {
		const finding: FactCheckFinding = {
			id: 'f1',
			turnId: 't1',
			speakerType: 'persona',
			claim: '日本の人口は2億人である',
			verdict: 'incorrect',
			correction: '日本の人口は約1.2億人である',
			reason: '総務省統計局のデータと矛盾するため',
			sources: [{ title: 'https://example.com', url: 'https://example.com' }]
		};
		expect(finding.turnId).toBe('t1');
		expect(finding.verdict).toBe('incorrect');
	});

	it('FactCheckVerdict は incorrect / unverifiable', () => {
		const verdicts: FactCheckVerdict[] = ['incorrect', 'unverifiable'];
		expect(verdicts).toHaveLength(2);
	});

	it('FactCheckStatus は running / completed / failed', () => {
		const statuses: FactCheckStatus[] = ['running', 'completed', 'failed'];
		expect(statuses).toHaveLength(3);
	});

	it('FactCheckResultForFirestore が章単位の結果ドキュメントを表す', () => {
		const result: FactCheckResultForFirestore = {
			chapterId: 'c1',
			status: 'completed',
			findings: [],
			sources: [],
			startedAt: { seconds: 0, nanoseconds: 0 } as Timestamp,
			completedAt: { seconds: 1, nanoseconds: 0 } as Timestamp
		};
		expect(result.status).toBe('completed');
		expect(result.findings).toEqual([]);
	});
});
