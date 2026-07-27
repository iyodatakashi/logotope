import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import type {
	PersonaForFirestore,
	Persona,
	InterviewForFirestore,
	DraftBelief,
	SearchSource,
	SearchResult
} from '../../types/persona.types.js';

describe('persona.types（functions） 永続形とランタイム形', () => {
	it('PersonaForFirestore は role 必須・nationality・interview 永続型を持つ', () => {
		const persona: PersonaForFirestore = {
			id: 'p1',
			topicId: 't1',
			name: '田中 太郎',
			age: 40,
			occupation: '会社員',
			stakeholderRole: '市民',
			stakeholderId: 'sid-1',
			role: '再審無罪となった元受刑者',
			background: '背景',
			interests: '関心',
			nationality: '日本',
			engagementLevel: 'high',
			gender: 'male',
			genderPresentation: 'masculine',
			colorKey: 'blue',
			selected: true,
			sortOrder: 0,
			interview: {
				status: 'completed',
				interviewRecord: '記録',
				completedAt: Timestamp.fromDate(new Date())
			}
		};
		expect(persona.role).toBe('再審無罪となった元受刑者');
		expect(persona.nationality).toBe('日本');
		expect(persona.interview?.completedAt).toBeInstanceOf(Timestamp);
	});

	it('ランタイム Persona は interview を interviewRecord へ平坦化し role を直接持つ', () => {
		const persona: Persona = {
			id: 'p1',
			topicId: 't1',
			name: '田中 太郎',
			age: 40,
			occupation: '会社員',
			stakeholderRole: '市民',
			stakeholderId: 'sid-1',
			role: '医師',
			background: '背景',
			interests: '関心',
			nationality: '日本',
			engagementLevel: 'high',
			gender: 'male',
			genderPresentation: 'masculine',
			colorKey: 'blue',
			selected: true,
			sortOrder: 0,
			interviewRecord: '取材記録'
		};
		expect(persona.role).toBe('医師');
		expect(persona.interviewRecord).toBe('取材記録');
	});

	it('InterviewForFirestore は draftBelief/sources を集約した永続サブ型で持つ', () => {
		const result: SearchResult = { title: 't', url: 'https://a' };
		const source: SearchSource = { query: 'q', summary: 's', results: [result] };
		const draft: DraftBelief = {
			stanceAndGrounds: '',
			coreClaims: '',
			concerns: '',
			values: '',
			compromisePoints: '',
			changePotential: ''
		};
		const interview: InterviewForFirestore = {
			status: 'completed',
			draftBelief: draft,
			sources: [source]
		};
		expect(interview.sources?.[0].results[0].url).toBe('https://a');
	});
});
