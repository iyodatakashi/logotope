import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { TurnForFirestore, Turn } from '$lib/models/turn/turn.types';

describe('turn.types', () => {
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
});
