import { describe, it, expect } from 'vitest';
import type { Timestamp } from 'firebase-admin/firestore';
import type {
	DebateTurn,
	NewTurnFields,
	TurnGenerationContext,
	TurnFactCheckTrace,
	TurnFactCheckFeedback
} from '../../types/turn.types.js';
import type { FactCheckFinding } from '../../types/fact-check.types.js';

const finding: FactCheckFinding = {
	id: 'f1',
	turnId: '',
	speakerType: 'persona',
	claim: '日本の人口は2億人である',
	verdict: 'incorrect',
	correction: '日本の人口は約1.2億人である',
	reason: '総務省統計局のデータと矛盾するため',
	sources: []
};

describe('turn.types ファクトチェック補正トレース', () => {
	it('TurnFactCheckTrace: 検証したが修正対象なし（checked / revised:false / findings:[]）', () => {
		const trace: TurnFactCheckTrace = { status: 'checked', revised: false, findings: [] };
		expect(trace.status).toBe('checked');
		expect(trace.revised).toBe(false);
		expect(trace.originalContent).toBeUndefined();
	});

	it('TurnFactCheckTrace: 補正して登録（checked / revised:true / findings / originalContent）', () => {
		const trace: TurnFactCheckTrace = {
			status: 'checked',
			revised: true,
			findings: [finding],
			originalContent: '補正前ドラフト本文'
		};
		expect(trace.revised).toBe(true);
		expect(trace.findings).toHaveLength(1);
		expect(trace.originalContent).toBe('補正前ドラフト本文');
	});

	it('TurnFactCheckTrace: 再生成失敗で原ドラフト登録（checked / revised:false / findings あり）', () => {
		const trace: TurnFactCheckTrace = { status: 'checked', revised: false, findings: [finding] };
		expect(trace.findings).toHaveLength(1);
	});

	it('TurnFactCheckTrace: 検証未完了で登録（unverified / revised:false）', () => {
		const trace: TurnFactCheckTrace = { status: 'unverified', revised: false, findings: [] };
		expect(trace.status).toBe('unverified');
	});

	it('DebateTurn / NewTurnFields に factCheck トレースを埋め込める', () => {
		const newTurn: NewTurnFields = {
			speakerType: 'persona',
			content: '補正済み発言',
			factCheck: { status: 'checked', revised: true, findings: [finding], originalContent: '原稿' }
		};
		const turn: DebateTurn = {
			id: 't1',
			speakerType: 'persona',
			content: '補正済み発言',
			createdAt: { seconds: 0, nanoseconds: 0 } as Timestamp,
			factCheck: newTurn.factCheck
		};
		expect(turn.factCheck?.revised).toBe(true);
		expect(newTurn.factCheck?.status).toBe('checked');
	});

	it('factCheck は任意フィールド（未指定でも型を満たす）', () => {
		const turn: NewTurnFields = { speakerType: 'facilitator', content: '司会発言' };
		expect(turn.factCheck).toBeUndefined();
	});

	it('TurnGenerationContext に factCheckFeedback（再生成フィードバック）を載せられる', () => {
		const feedback: TurnFactCheckFeedback = [
			{
				claim: '日本の人口は2億人である',
				verdict: 'incorrect',
				correction: '日本の人口は約1.2億人である',
				reason: '総務省統計局のデータと矛盾するため'
			}
		];
		const context: TurnGenerationContext = {
			chapterTurns: [],
			chapter: {} as TurnGenerationContext['chapter'],
			factCheckFeedback: feedback
		};
		expect(context.factCheckFeedback?.[0].verdict).toBe('incorrect');
	});
});
