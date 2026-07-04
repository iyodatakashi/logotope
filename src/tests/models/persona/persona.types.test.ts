import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type {
	BeliefForFirestore,
	Belief,
	AwarenessForFirestore,
	Awareness,
	InterviewForFirestore,
	Interview,
	PersonaForFirestore,
	Persona
} from '$lib/models/persona/persona.types';

describe('persona.types - Firestore 型とアプリ型', () => {
	it('BeliefForFirestore は初期信念のみ（id/version/content/createdAt）を持つ', () => {
		const belief: BeliefForFirestore = {
			id: 'b1',
			version: 0,
			content: '信念内容',
			createdAt: Timestamp.fromDate(new Date())
		};
		expect(belief.createdAt).toBeInstanceOf(Timestamp);
	});

	it('Belief は createdAt: Date を持つ', () => {
		const belief: Belief = {
			id: 'b1',
			version: 0,
			content: '信念内容',
			createdAt: new Date()
		};
		expect(belief.createdAt).toBeInstanceOf(Date);
	});

	it('AwarenessForFirestore は kind/sourcePersonaId/triggeredByTurnId/createdAt(Timestamp) を持つ', () => {
		const awareness: AwarenessForFirestore = {
			id: 'a1',
			kind: 'reception',
			content: '一理あると受け止めた',
			sourcePersonaId: 'p2',
			triggeredByTurnId: 't10',
			createdAt: Timestamp.fromDate(new Date())
		};
		expect(awareness.createdAt).toBeInstanceOf(Timestamp);
		expect(awareness.kind).toBe('reception');
	});

	it('Awareness は createdAt: Date を持ち、self は sourcePersonaId=null', () => {
		const awareness: Awareness = {
			id: 'a2',
			kind: 'self',
			content: '自分の観点から気づいた',
			sourcePersonaId: null,
			triggeredByTurnId: 't11',
			createdAt: new Date()
		};
		expect(awareness.createdAt).toBeInstanceOf(Date);
		expect(awareness.sourcePersonaId).toBeNull();
	});

	it('InterviewForFirestore は completedAt?: Timestamp を持つ', () => {
		const interview: InterviewForFirestore = {
			status: 'completed',
			completedAt: Timestamp.fromDate(new Date())
		};
		expect(interview.completedAt).toBeInstanceOf(Timestamp);
	});

	it('Interview は completedAt?: Date を持つ', () => {
		const interview: Interview = {
			status: 'completed',
			completedAt: new Date()
		};
		expect(interview.completedAt).toBeInstanceOf(Date);
	});

	it('PersonaForFirestore は beliefs/awarenesses を ForFirestore 型で持つ', () => {
		const persona: PersonaForFirestore = {
			id: 'p1',
			topicId: 't1',
			stakeholderRole: '市民',
			specificRole: undefined,
			name: '田中太郎',
			age: 40,
			occupation: '会社員',
			background: '背景',
			interests: '関心',
			approved: true,
			sortOrder: 0,
			beliefs: [
				{
					id: 'b1',
					version: 0,
					content: '信念',
					createdAt: Timestamp.fromDate(new Date())
				}
			],
			awarenesses: [
				{
					id: 'a1',
					kind: 'reception',
					content: '気づき',
					sourcePersonaId: 'p2',
					triggeredByTurnId: 't10',
					createdAt: Timestamp.fromDate(new Date())
				}
			]
		};
		expect(persona.beliefs[0].createdAt).toBeInstanceOf(Timestamp);
		expect(persona.awarenesses?.[0].createdAt).toBeInstanceOf(Timestamp);
	});

	it('Persona は beliefs/awarenesses をアプリ型（createdAt: Date）で持つ', () => {
		const persona: Persona = {
			id: 'p1',
			topicId: 't1',
			stakeholderRole: '市民',
			specificRole: undefined,
			name: '田中太郎',
			age: 40,
			occupation: '会社員',
			background: '背景',
			interests: '関心',
			approved: true,
			sortOrder: 0,
			beliefs: [
				{
					id: 'b1',
					version: 0,
					content: '信念',
					createdAt: new Date()
				}
			],
			awarenesses: [
				{
					id: 'a1',
					kind: 'self',
					content: '気づき',
					sourcePersonaId: null,
					triggeredByTurnId: 't11',
					createdAt: new Date()
				}
			]
		};
		expect(persona.beliefs[0].createdAt).toBeInstanceOf(Date);
		expect(persona.awarenesses?.[0].createdAt).toBeInstanceOf(Date);
	});
});
