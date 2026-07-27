import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
	toPersonaForDisplay,
	type BeliefForFirestore,
	type Belief,
	type AwarenessForFirestore,
	type Awareness,
	type InterviewForFirestore,
	type Interview,
	type PersonaForFirestore,
	type Persona,
	type PersonaForDisplay
} from '$lib/models/persona/persona.types';

describe('persona.types - Firestore 型とアプリ型', () => {
	it('BeliefForFirestore は信念のみ（id/version/content/createdAt）を持つ', () => {
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

	it('InterviewForFirestore は researchSummary を持たない（functions が永続しない幽霊フィールドを削除）', () => {
		const interview: InterviewForFirestore = {
			status: 'completed',
			// @ts-expect-error researchSummary は永続形から削除された
			researchSummary: '要約'
		};
		expect(interview.status).toBe('completed');
	});

	it('PersonaForFirestore は role 必須・nationality を持ち、beliefs/awarenesses を ForFirestore 型で持つ', () => {
		const persona: PersonaForFirestore = {
			id: 'p1',
			topicId: 't1',
			stakeholderRole: '市民',
			stakeholderId: 'sid-1',
			role: '医師',
			name: '田中 太郎',
			age: 40,
			occupation: '会社員',
			background: '背景',
			interests: '関心',
			nationality: '日本',
			gender: 'male',
			genderPresentation: 'masculine',
			colorKey: 'blue',
			selected: true,
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
		expect(persona.role).toBe('医師');
		expect(persona.nationality).toBe('日本');
		expect(persona.beliefs[0].createdAt).toBeInstanceOf(Timestamp);
		expect(persona.awarenesses?.[0].createdAt).toBeInstanceOf(Timestamp);
	});

	it('Persona は role 必須・nationality を持ち、beliefs/awarenesses をアプリ型（createdAt: Date）で持つ', () => {
		const persona: Persona = {
			id: 'p1',
			topicId: 't1',
			stakeholderRole: '市民',
			stakeholderId: 'sid-1',
			role: '医師',
			name: '田中 太郎',
			age: 40,
			occupation: '会社員',
			background: '背景',
			interests: '関心',
			nationality: '日本',
			gender: 'male',
			genderPresentation: 'masculine',
			colorKey: 'blue',
			selected: true,
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
		expect(persona.role).toBe('医師');
		expect(persona.nationality).toBe('日本');
		expect(persona.beliefs[0].createdAt).toBeInstanceOf(Date);
		expect(persona.awarenesses?.[0].createdAt).toBeInstanceOf(Date);
	});
});

describe('toPersonaForDisplay - 表示用の軽量写像', () => {
	const fullPersona = (): Persona => ({
		id: 'p1',
		topicId: 't1',
		stakeholderRole: '市民',
		stakeholderId: 'sid-1',
		role: '医師',
		name: '田中 太郎',
		age: 40,
		occupation: '会社員',
		background: '背景',
		interests: '関心',
		nationality: '日本',
		engagementLevel: 'high',
		gender: 'male',
		genderPresentation: 'masculine',
		colorKey: 'blue',
		avatarGeneratedAt: new Date('2026-01-01T00:00:00Z'),
		selected: true,
		sortOrder: 0,
		beliefs: []
	});

	it('id/topicId/name/role/colorKey/avatarGeneratedAt のみを写す（役割は導出せず直参照）', () => {
		const display: PersonaForDisplay = toPersonaForDisplay(fullPersona());
		expect(display).toEqual({
			id: 'p1',
			topicId: 't1',
			name: '田中 太郎',
			role: '医師',
			colorKey: 'blue',
			avatarGeneratedAt: new Date('2026-01-01T00:00:00Z')
		});
	});

	it('管理専用フィールド・nationality を含めない（描画に不要な最小形）。topicId はアバターパス用に保持する', () => {
		const display = toPersonaForDisplay(fullPersona());
		expect(Object.keys(display).sort()).toEqual([
			'avatarGeneratedAt',
			'colorKey',
			'id',
			'name',
			'role',
			'topicId'
		]);
		expect('nationality' in display).toBe(false);
		expect('background' in display).toBe(false);
		expect('stakeholderRole' in display).toBe(false);
		// topicId はアバター画像パス構築に必要なため含める
		expect(display.topicId).toBe('t1');
	});
});
