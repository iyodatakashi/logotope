import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PersonaDoc } from '$lib/models/persona/persona.types.js';

const { mockState, mockTopicMethods, mockPersonasMethods } = vi.hoisted(() => ({
	mockState: {
		personas: [] as PersonaDoc[],
		topicExists: true
	},
	mockTopicMethods: {
		generateStakeholders: vi.fn().mockResolvedValue(undefined),
		generatePersonas: vi.fn().mockResolvedValue(undefined),
		generateChapters: vi.fn().mockResolvedValue(undefined),
		startDebate: vi.fn().mockResolvedValue(undefined),
		stopDebate: vi.fn().mockResolvedValue(undefined),
		approveStakeholders: vi.fn().mockResolvedValue(undefined),
		approveInterviews: vi.fn().mockResolvedValue(undefined),
		approveChapters: vi.fn().mockResolvedValue(undefined),
		clearDebateSession: vi.fn().mockResolvedValue(undefined),
		regenerateDebate: vi.fn().mockResolvedValue(undefined)
	},
	mockPersonasMethods: {
		approvePersonas: vi.fn().mockResolvedValue(undefined),
		runInterviews: vi.fn().mockResolvedValue(undefined)
	}
}));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			if (!mockState.topicExists) return undefined;
			return { id: 't1', title: 'テスト', ...mockTopicMethods };
		},
		get personasStore() {
			return { personas: mockState.personas, ...mockPersonasMethods };
		}
	}
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/firebase.js', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
	httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: { topicId: 't1' } }))
}));

import { goto } from '$app/navigation';
import { httpsCallable } from 'firebase/functions';
import { phaseActions } from './phaseActions.js';

describe('phaseActions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.values(mockTopicMethods).forEach((fn) =>
			(fn as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
		);
		Object.values(mockPersonasMethods).forEach((fn) =>
			(fn as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
		);
		vi.mocked(httpsCallable).mockReturnValue(
			vi.fn().mockResolvedValue({ data: { topicId: 't1' } }) as never
		);
		mockState.personas = [];
		mockState.topicExists = true;
	});

	describe('generate', () => {
		it('フェーズ1: generateStakeholders を呼ぶ', async () => {
			await phaseActions.generate(1);
			expect(mockTopicMethods.generateStakeholders).toHaveBeenCalled();
		});

		it('フェーズ2: generatePersonas を呼ぶ', async () => {
			await phaseActions.generate(2);
			expect(mockTopicMethods.generatePersonas).toHaveBeenCalled();
		});

		it('フェーズ3: runInterviews を topic.title で呼ぶ', async () => {
			await phaseActions.generate(3);
			expect(mockPersonasMethods.runInterviews).toHaveBeenCalledWith('テスト');
		});

		it('フェーズ4: generateChapters を呼ぶ', async () => {
			await phaseActions.generate(4);
			expect(mockTopicMethods.generateChapters).toHaveBeenCalled();
		});

		it('フェーズ5: startDebate を呼ぶ', async () => {
			await phaseActions.generate(5);
			expect(mockTopicMethods.startDebate).toHaveBeenCalled();
		});

		it('topic 未存在なら何もしない', async () => {
			mockState.topicExists = false;
			await phaseActions.generate(1);
			expect(mockTopicMethods.generateStakeholders).not.toHaveBeenCalled();
		});
	});

	describe('approve', () => {
		it('フェーズ1: approveStakeholders → goto personas', async () => {
			await phaseActions.approve(1);
			expect(mockTopicMethods.approveStakeholders).toHaveBeenCalled();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/personas');
		});

		it('フェーズ2: approvePersonas → goto interviews', async () => {
			await phaseActions.approve(2);
			expect(mockPersonasMethods.approvePersonas).toHaveBeenCalled();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/interviews');
		});

		it('フェーズ3: approveInterviews → goto chapters', async () => {
			await phaseActions.approve(3);
			expect(mockTopicMethods.approveInterviews).toHaveBeenCalled();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/chapters');
		});

		it('フェーズ4: approveChapters → goto debate', async () => {
			await phaseActions.approve(4);
			expect(mockTopicMethods.approveChapters).toHaveBeenCalled();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/debate');
		});

		it('フェーズ5は承認なし（goto しない）', async () => {
			await phaseActions.approve(5);
			expect(goto).not.toHaveBeenCalled();
		});
	});

	describe('regenerate', () => {
		it('フェーズ1: generateStakeholders を呼ぶ', async () => {
			await phaseActions.regenerate(1);
			expect(mockTopicMethods.generateStakeholders).toHaveBeenCalled();
		});

		it('フェーズ3: clearDebateSession の後に全ペルソナ再取材する', async () => {
			await phaseActions.regenerate(3);
			expect(mockTopicMethods.clearDebateSession).toHaveBeenCalled();
			expect(mockPersonasMethods.runInterviews).toHaveBeenCalledWith('テスト', true);
		});

		it('フェーズ5: regenerateDebate を呼ぶ', async () => {
			await phaseActions.regenerate(5);
			expect(mockTopicMethods.regenerateDebate).toHaveBeenCalled();
		});
	});

	describe('stopDebate', () => {
		it('topic.stopDebate を呼ぶ', async () => {
			await phaseActions.stopDebate();
			expect(mockTopicMethods.stopDebate).toHaveBeenCalled();
		});
	});

	describe('restartDebate', () => {
		it('restartDebate callable を呼ぶ', async () => {
			const mockRestartFn = vi.fn().mockResolvedValue({ data: { topicId: 't1' } });
			vi.mocked(httpsCallable).mockReturnValue(mockRestartFn as never);
			await phaseActions.restartDebate();
			expect(httpsCallable).toHaveBeenCalledWith(
				expect.anything(),
				'restartDebate',
				expect.any(Object)
			);
			expect(mockRestartFn).toHaveBeenCalledWith({ topicId: 't1' });
		});
	});

	describe('retry', () => {
		it('生成と同じ経路で再実行する（フェーズ1: generateStakeholders）', async () => {
			await phaseActions.retry(1);
			expect(mockTopicMethods.generateStakeholders).toHaveBeenCalled();
		});
	});
});
