import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type {
	TurnForFirestore,
	Turn,
	TurnStatus,
	FactCheckVerdict,
	FactCheckFinding,
	TurnFactCheckTrace
} from '$lib/models/turn/turn.types';

describe('turn.types', () => {
	it('FactCheckVerdict は incorrect / unverifiable', () => {
		const verdicts: FactCheckVerdict[] = ['incorrect', 'unverifiable'];
		expect(verdicts).toHaveLength(2);
	});

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

	it('TurnFactCheckTrace は補正トレース（検証状態・補正有無・適用指摘・補正前ドラフト）を表す', () => {
		const trace: TurnFactCheckTrace = {
			status: 'checked',
			revised: true,
			findings: [
				{
					id: 'f1',
					turnId: '',
					speakerType: 'persona',
					claim: '誤った主張',
					verdict: 'incorrect',
					correction: '正しい事実',
					reason: '理由',
					sources: []
				}
			],
			originalContent: '補正前ドラフト'
		};
		expect(trace.status).toBe('checked');
		expect(trace.revised).toBe(true);
		expect(trace.originalContent).toBe('補正前ドラフト');

		const unverified: TurnFactCheckTrace = { status: 'unverified', revised: false, findings: [] };
		expect(unverified.originalContent).toBeUndefined();
	});

	it('TurnForFirestore に補正トレース factCheck を埋め込める', () => {
		const turn: TurnForFirestore = {
			id: 't1',
			speakerType: 'persona',
			content: '補正済み発言',
			createdAt: Timestamp.fromDate(new Date()),
			factCheck: { status: 'checked', revised: true, findings: [], originalContent: '原稿' }
		};
		expect(turn.factCheck?.revised).toBe(true);
	});

	it('factCheck は任意フィールド（未指定でも型を満たす）', () => {
		const turn: Turn = {
			id: 't1',
			speakerType: 'facilitator',
			content: '司会発言',
			createdAt: new Date()
		};
		expect(turn.factCheck).toBeUndefined();
	});

	it('TurnStatus=evaluating を TurnForFirestore に反映できる（永続ミラー）', () => {
		const status: TurnStatus = 'evaluating';
		const turn: TurnForFirestore = {
			id: 't1',
			speakerType: 'persona',
			content: '確定発言',
			createdAt: Timestamp.fromDate(new Date()),
			status
		};
		expect(turn.status).toBe('evaluating');
	});

	it('status は任意フィールド（評価完了後は未設定）', () => {
		const turn: Turn = {
			id: 't1',
			speakerType: 'persona',
			content: '確定発言',
			createdAt: new Date()
		};
		expect(turn.status).toBeUndefined();
	});
});
