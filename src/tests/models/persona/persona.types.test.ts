import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type {
	BeliefForFirestore,
	Belief,
	InterviewForFirestore,
	Interview,
	PersonaForFirestore,
	Persona
} from '$lib/models/persona/persona.types';

describe('persona.types - Firestore 型とアプリ型', () => {
	it('BeliefForFirestore は createdAt: Timestamp を持つ', () => {
		const belief: BeliefForFirestore = {
			id: 'b1',
			version: 1,
			content: '信念内容',
			createdAt: Timestamp.fromDate(new Date())
		};
		expect(belief.createdAt).toBeInstanceOf(Timestamp);
	});

	it('Belief は createdAt: Date を持つ', () => {
		const belief: Belief = {
			id: 'b1',
			version: 1,
			content: '信念内容',
			createdAt: new Date()
		};
		expect(belief.createdAt).toBeInstanceOf(Date);
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

	it('PersonaForFirestore は beliefs: BeliefForFirestore[] と interview?: InterviewForFirestore を持つ', () => {
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
					version: 1,
					content: '信念',
					createdAt: Timestamp.fromDate(new Date())
				}
			]
		};
		expect(persona.beliefs[0].createdAt).toBeInstanceOf(Timestamp);
	});

	it('Persona は beliefs: Belief[] と interview?: Interview を持つ', () => {
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
					version: 1,
					content: '信念',
					createdAt: new Date()
				}
			]
		};
		expect(persona.beliefs[0].createdAt).toBeInstanceOf(Date);
	});
});
