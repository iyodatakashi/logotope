import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Phase, PhaseStatus } from '$lib/utils/phase.js';
import type { SessionStatus } from '$lib/models/session/session.types.js';
import type { PersonaDoc } from '$lib/models/persona/persona.types.js';

const { mockState, mockTopicMethods, mockPersonasMethods } = vi.hoisted(() => ({
	mockState: {
		topicPhase: 1 as Phase,
		topicPhaseStatus: 'not_started' as PhaseStatus,
		sessionStatus: undefined as SessionStatus | undefined,
		personas: [] as PersonaDoc[],
		topicExists: true
	},
	mockTopicMethods: {
		generateStakeholders: vi.fn().mockResolvedValue(undefined),
		generatePersonas: vi.fn().mockResolvedValue(undefined),
		generateChapters: vi.fn().mockResolvedValue(undefined),
		startDebate: vi.fn().mockResolvedValue(undefined),
		approveStakeholders: vi.fn().mockResolvedValue(undefined),
		approveInterviews: vi.fn().mockResolvedValue(undefined),
		approveChapters: vi.fn().mockResolvedValue(undefined),
		clearDebateSession: vi.fn().mockResolvedValue(undefined),
		regenerateDebate: vi.fn().mockResolvedValue(undefined),
		cancelDebate: vi.fn().mockResolvedValue(undefined)
	},
	mockPersonasMethods: {
		approvePersonas: vi.fn().mockResolvedValue(undefined),
		runInterview: vi.fn().mockResolvedValue(undefined),
		markInterviewsStarted: vi.fn().mockResolvedValue(undefined),
		markInterviewsComplete: vi.fn().mockResolvedValue(undefined)
	}
}));

vi.mock('$lib/stores/currentTopic.svelte.js', () => ({
	currentTopicStore: {
		get topic() {
			if (!mockState.topicExists) return undefined;
			return {
				id: 't1',
				title: 'テスト',
				phase: mockState.topicPhase,
				phaseStatus: mockState.topicPhaseStatus,
				...mockTopicMethods
			};
		},
		get sessionStore() {
			return {
				session: mockState.sessionStatus ? { status: mockState.sessionStatus } : null
			};
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
import { createPhaseController } from './phaseController.svelte.js';

describe('createPhaseController', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		Object.values(mockTopicMethods).forEach((fn) =>
			(fn as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
		);
		Object.values(mockPersonasMethods).forEach((fn) =>
			(fn as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
		);
		vi.mocked(httpsCallable).mockReturnValue(
			vi.fn().mockResolvedValue({ data: { topicId: 't1' } }) as never
		);
		mockState.topicPhase = 1;
		mockState.topicPhaseStatus = 'not_started';
		mockState.sessionStatus = undefined;
		mockState.personas = [];
		mockState.topicExists = true;
	});

	describe('logicalState の導出 (task 4.1)', () => {
		it('topic が存在しない場合は not_started', () => {
			mockState.topicExists = false;
			const ctrl = createPhaseController(1);
			expect(ctrl.logicalState).toBe('not_started');
		});

		it('対象フェーズ < currentPhase → approved', () => {
			mockState.topicPhase = 3;
			mockState.topicPhaseStatus = 'not_started';
			const ctrl = createPhaseController(1);
			expect(ctrl.logicalState).toBe('approved');
		});

		it('対象フェーズ > currentPhase → not_started', () => {
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'generated';
			const ctrl = createPhaseController(3);
			expect(ctrl.logicalState).toBe('not_started');
		});

		it('対象フェーズ === currentPhase で generated → generated', () => {
			mockState.topicPhase = 2;
			mockState.topicPhaseStatus = 'generated';
			const ctrl = createPhaseController(2);
			expect(ctrl.logicalState).toBe('generated');
		});

		it('フェーズ5 + session cancelled → stopped', () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'cancelled';
			const ctrl = createPhaseController(5);
			expect(ctrl.logicalState).toBe('stopped');
		});
	});

	describe('runGenerate (task 4.1)', () => {
		it('フェーズ1: generateStakeholders を呼ぶ', async () => {
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'not_started';
			const ctrl = createPhaseController(1);
			await ctrl.runGenerate();
			expect(mockTopicMethods.generateStakeholders).toHaveBeenCalled();
		});

		it('フェーズ2: generatePersonas を呼ぶ', async () => {
			mockState.topicPhase = 2;
			mockState.topicPhaseStatus = 'not_started';
			const ctrl = createPhaseController(2);
			await ctrl.runGenerate();
			expect(mockTopicMethods.generatePersonas).toHaveBeenCalled();
		});

		it('フェーズ3: markInterviewsStarted を runInterview より前に呼ぶ', async () => {
			const order: string[] = [];
			mockPersonasMethods.markInterviewsStarted.mockImplementation(async () => {
				order.push('started');
			});
			mockPersonasMethods.runInterview.mockImplementation(async () => {
				order.push('interview');
			});
			mockState.topicPhase = 3;
			mockState.topicPhaseStatus = 'not_started';
			mockState.personas = [{ id: 'p1' } as PersonaDoc];
			const ctrl = createPhaseController(3);
			await ctrl.runGenerate();
			expect(order[0]).toBe('started');
			expect(order[1]).toBe('interview');
		});

		it('フェーズ3: 未完了ペルソナの runInterview → markInterviewsComplete', async () => {
			const personas = [
				{ id: 'p1', interview: { status: 'completed' } },
				{ id: 'p2', interview: undefined }
			] as PersonaDoc[];
			mockState.topicPhase = 3;
			mockState.topicPhaseStatus = 'not_started';
			mockState.personas = personas;
			const ctrl = createPhaseController(3);
			await ctrl.runGenerate();
			expect(mockPersonasMethods.runInterview).toHaveBeenCalledWith('p2', 'テスト');
			expect(mockPersonasMethods.runInterview).not.toHaveBeenCalledWith('p1', expect.anything());
			expect(mockPersonasMethods.markInterviewsComplete).toHaveBeenCalled();
		});

		it('フェーズ4: generateChapters を呼ぶ', async () => {
			mockState.topicPhase = 4;
			mockState.topicPhaseStatus = 'not_started';
			const ctrl = createPhaseController(4);
			await ctrl.runGenerate();
			expect(mockTopicMethods.generateChapters).toHaveBeenCalled();
		});

		it('フェーズ5: startDebate を呼ぶ', async () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'not_started';
			const ctrl = createPhaseController(5);
			await ctrl.runGenerate();
			expect(mockTopicMethods.startDebate).toHaveBeenCalled();
		});

		it('失敗時に error を設定し inFlight は false に戻る', async () => {
			mockTopicMethods.generateStakeholders.mockRejectedValue(new Error('生成失敗'));
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'not_started';
			const ctrl = createPhaseController(1);
			await ctrl.runGenerate();
			expect(ctrl.error).toBe('生成失敗');
			expect(ctrl.inFlight).toBe(false);
		});

		it('成功後に error は null', async () => {
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'not_started';
			const ctrl = createPhaseController(1);
			await ctrl.runGenerate();
			expect(ctrl.error).toBeNull();
		});

		it('フェーズ5 討論中は実行しない（running ガード）', async () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'debating';
			const ctrl = createPhaseController(5);
			await ctrl.runGenerate();
			expect(mockTopicMethods.startDebate).not.toHaveBeenCalled();
		});

		it('inFlight 中は再実行しない', async () => {
			let resolveGenerate!: () => void;
			mockTopicMethods.generateStakeholders.mockReturnValue(
				new Promise<void>((r) => { resolveGenerate = r; })
			);
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'not_started';
			const ctrl = createPhaseController(1);
			const p1 = ctrl.runGenerate();
			const p2 = ctrl.runGenerate();
			resolveGenerate();
			await Promise.all([p1, p2]);
			expect(mockTopicMethods.generateStakeholders).toHaveBeenCalledTimes(1);
		});
	});

	describe('runApprove (task 4.1)', () => {
		it('フェーズ1: approveStakeholders → goto personas', async () => {
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'generated';
			const ctrl = createPhaseController(1);
			await ctrl.runApprove();
			expect(mockTopicMethods.approveStakeholders).toHaveBeenCalled();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/personas');
		});

		it('フェーズ2: approvePersonas → goto interviews', async () => {
			mockState.topicPhase = 2;
			mockState.topicPhaseStatus = 'generated';
			const ctrl = createPhaseController(2);
			await ctrl.runApprove();
			expect(mockPersonasMethods.approvePersonas).toHaveBeenCalled();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/interviews');
		});

		it('フェーズ3: approveInterviews → goto chapters', async () => {
			mockState.topicPhase = 3;
			mockState.topicPhaseStatus = 'generated';
			const ctrl = createPhaseController(3);
			await ctrl.runApprove();
			expect(mockTopicMethods.approveInterviews).toHaveBeenCalled();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/chapters');
		});

		it('フェーズ4: approveChapters → goto debate', async () => {
			mockState.topicPhase = 4;
			mockState.topicPhaseStatus = 'generated';
			const ctrl = createPhaseController(4);
			await ctrl.runApprove();
			expect(mockTopicMethods.approveChapters).toHaveBeenCalled();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/debate');
		});

		it('フェーズ5は forwardAction なし → no-op', async () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'generated';
			const ctrl = createPhaseController(5);
			await ctrl.runApprove();
			expect(goto).not.toHaveBeenCalled();
		});

		it('失敗時に error を設定し goto しない', async () => {
			mockTopicMethods.approveStakeholders.mockRejectedValue(new Error('承認失敗'));
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'generated';
			const ctrl = createPhaseController(1);
			await ctrl.runApprove();
			expect(ctrl.error).toBe('承認失敗');
			expect(goto).not.toHaveBeenCalled();
		});

		it('logicalState が generated でない場合は実行しない', async () => {
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'not_started';
			const ctrl = createPhaseController(1);
			await ctrl.runApprove();
			expect(mockTopicMethods.approveStakeholders).not.toHaveBeenCalled();
		});
	});

	describe('clearError (task 4.1)', () => {
		it('error をクリアする', async () => {
			mockTopicMethods.generateStakeholders.mockRejectedValue(new Error('エラー'));
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'not_started';
			const ctrl = createPhaseController(1);
			await ctrl.runGenerate();
			expect(ctrl.error).not.toBeNull();
			ctrl.clearError();
			expect(ctrl.error).toBeNull();
		});
	});

	describe('runRegenerate (task 4.2)', () => {
		it('フェーズ1: generateStakeholders を呼ぶ', async () => {
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'generated';
			const ctrl = createPhaseController(1);
			await ctrl.runRegenerate();
			expect(mockTopicMethods.generateStakeholders).toHaveBeenCalled();
		});

		it('フェーズ5: regenerateDebate を呼ぶ', async () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'generated';
			const ctrl = createPhaseController(5);
			await ctrl.runRegenerate();
			expect(mockTopicMethods.regenerateDebate).toHaveBeenCalled();
		});

		it('フェーズ5 stopped 状態でも regenerate できる', async () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'cancelled';
			const ctrl = createPhaseController(5);
			await ctrl.runRegenerate();
			expect(mockTopicMethods.regenerateDebate).toHaveBeenCalled();
		});

		it('フェーズ5 討論中は実行しない', async () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'debating';
			const ctrl = createPhaseController(5);
			await ctrl.runRegenerate();
			expect(mockTopicMethods.regenerateDebate).not.toHaveBeenCalled();
		});
	});

	describe('runStop / runRestart の可用性 (task 4.2)', () => {
		it('フェーズ5は runStop を持つ', () => {
			const ctrl = createPhaseController(5);
			expect(ctrl.runStop).toBeDefined();
		});

		it('フェーズ1〜4は runStop を持たない', () => {
			([1, 2, 3, 4] as Phase[]).forEach((phase) => {
				expect(createPhaseController(phase).runStop).toBeUndefined();
			});
		});

		it('フェーズ5は runRestart を持つ', () => {
			const ctrl = createPhaseController(5);
			expect(ctrl.runRestart).toBeDefined();
		});

		it('フェーズ1〜4は runRestart を持たない', () => {
			([1, 2, 3, 4] as Phase[]).forEach((phase) => {
				expect(createPhaseController(phase).runRestart).toBeUndefined();
			});
		});
	});

	describe('runStop / runRestart の動作 (task 4.2)', () => {
		it('runStop は cancelDebate を呼ぶ（running 状態でも実行できる）', async () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'debating';
			const ctrl = createPhaseController(5);
			await ctrl.runStop?.();
			expect(mockTopicMethods.cancelDebate).toHaveBeenCalled();
		});

		it('runStop は stopped 状態では実行しない', async () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'cancelled';
			const ctrl = createPhaseController(5);
			await ctrl.runStop?.();
			expect(mockTopicMethods.cancelDebate).not.toHaveBeenCalled();
		});

		it('runRestart は restartDebate callable を呼ぶ', async () => {
			const mockRestartFn = vi.fn().mockResolvedValue({ data: { topicId: 't1' } });
			vi.mocked(httpsCallable).mockReturnValue(mockRestartFn as never);
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'cancelled';
			const ctrl = createPhaseController(5);
			await ctrl.runRestart?.();
			expect(httpsCallable).toHaveBeenCalledWith(
				expect.anything(),
				'restartDebate',
				expect.any(Object)
			);
			expect(mockRestartFn).toHaveBeenCalledWith({ topicId: 't1' });
		});

		it('runRestart は stopped 状態以外では実行しない', async () => {
			const mockRestartFn = vi.fn().mockResolvedValue({ data: { topicId: 't1' } });
			vi.mocked(httpsCallable).mockReturnValue(mockRestartFn as never);
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'debating'; // not stopped
			const ctrl = createPhaseController(5);
			await ctrl.runRestart?.();
			expect(mockRestartFn).not.toHaveBeenCalled();
		});
	});
});
