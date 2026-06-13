/**
 * フェーズワークフロー結合テスト (task 8.2)
 *
 * 承認連鎖・再生成・討論ライフサイクルのシナリオを通じて
 * コントローラと2軸状態モデルが一貫して動作することを検証する。
 */
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

describe('フェーズワークフロー結合テスト', () => {
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

	describe('承認連鎖: フェーズ1→5 で2軸が順次遷移する', () => {
		it('フェーズ1承認後: フェーズ1は approved、フェーズ2は not_started になる', async () => {
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'generated';
			const ctrl1 = createPhaseController(1);
			const ctrl2 = createPhaseController(2);

			expect(ctrl1.logicalState).toBe('generated');
			expect(ctrl2.logicalState).toBe('not_started');

			await ctrl1.runApprove();
			expect(mockTopicMethods.approveStakeholders).toHaveBeenCalled();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/personas');

			// Firestoreへの書き込みをシミュレート: (2, not_started) へ前進
			mockState.topicPhase = 2;
			mockState.topicPhaseStatus = 'not_started';

			expect(ctrl1.logicalState).toBe('approved');
			expect(ctrl2.logicalState).toBe('not_started');
		});

		it('フェーズ2承認後: フェーズ2は approved、フェーズ3は not_started になる', async () => {
			mockState.topicPhase = 2;
			mockState.topicPhaseStatus = 'generated';
			const ctrl2 = createPhaseController(2);
			const ctrl3 = createPhaseController(3);

			await ctrl2.runApprove();
			expect(mockPersonasMethods.approvePersonas).toHaveBeenCalled();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/interviews');

			// (3, not_started) へ前進
			mockState.topicPhase = 3;
			mockState.topicPhaseStatus = 'not_started';

			expect(ctrl2.logicalState).toBe('approved');
			expect(ctrl3.logicalState).toBe('not_started');
		});

		it('フェーズ3→4→5 の承認連鎖が正しい goto を呼ぶ', async () => {
			// Phase 3 approve
			mockState.topicPhase = 3;
			mockState.topicPhaseStatus = 'generated';
			await createPhaseController(3).runApprove();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/chapters');

			// Phase 4 approve
			mockState.topicPhase = 4;
			mockState.topicPhaseStatus = 'generated';
			await createPhaseController(4).runApprove();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/debate');

			// Phase 5 has no forwardAction: approve is no-op
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'generated';
			const ctrl5 = createPhaseController(5);
			await ctrl5.runApprove();
			expect(goto).toHaveBeenCalledTimes(2); // called only for phases 3 and 4
		});
	});

	describe('中間フェーズ再生成: 下流フェーズは not_started として扱われる', () => {
		it('フェーズ1再生成後: フェーズ2以降は not_started として表示される', async () => {
			// Phase 3 まで到達した状態 (phase 1, 2 は approved)
			mockState.topicPhase = 3;
			mockState.topicPhaseStatus = 'generated';

			const ctrl1 = createPhaseController(1);
			const ctrl2 = createPhaseController(2);
			const ctrl3 = createPhaseController(3);

			expect(ctrl1.logicalState).toBe('approved');
			expect(ctrl2.logicalState).toBe('approved');
			expect(ctrl3.logicalState).toBe('generated');

			// フェーズ1を再生成
			await ctrl1.runRegenerate();
			expect(mockTopicMethods.generateStakeholders).toHaveBeenCalled();

			// Firestoreへの書き込みをシミュレート: (1, generated) へ巻き戻し
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'generated';

			expect(ctrl1.logicalState).toBe('generated');
			expect(ctrl2.logicalState).toBe('not_started');
			expect(ctrl3.logicalState).toBe('not_started');
		});

		it('フェーズ3再生成後: フェーズ4, 5は not_started として表示される', async () => {
			// Phase 4 まで到達した状態
			mockState.topicPhase = 4;
			mockState.topicPhaseStatus = 'not_started';

			const ctrl3 = createPhaseController(3);
			const ctrl4 = createPhaseController(4);

			expect(ctrl3.logicalState).toBe('approved');
			expect(ctrl4.logicalState).toBe('not_started');

			// フェーズ3を再生成（approved → generateInterviews + markComplete）
			mockState.personas = [{ id: 'p1' } as PersonaDoc];
			await ctrl3.runRegenerate();
			expect(mockTopicMethods.clearDebateSession).toHaveBeenCalled();
			expect(mockPersonasMethods.runInterview).toHaveBeenCalledWith('p1', 'テスト');
			expect(mockPersonasMethods.markInterviewsComplete).toHaveBeenCalled();

			// (3, generated) へ巻き戻し
			mockState.topicPhase = 3;
			mockState.topicPhaseStatus = 'generated';

			expect(ctrl3.logicalState).toBe('generated');
			expect(ctrl4.logicalState).toBe('not_started');
		});
	});

	describe('討論ライフサイクル: 開始→停止→再開', () => {
		it('開始→停止→再開のシナリオで状態が正しく遷移する', async () => {
			// Phase 5 not_started → 討論開始
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'not_started';
			const ctrl5 = createPhaseController(5);

			expect(ctrl5.logicalState).toBe('not_started');
			await ctrl5.runGenerate();
			expect(mockTopicMethods.startDebate).toHaveBeenCalled();

			// Firestoreが (5, running) + session 'debating' に更新
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'debating';
			expect(ctrl5.logicalState).toBe('running');

			// 停止
			await ctrl5.runStop!();
			expect(mockTopicMethods.cancelDebate).toHaveBeenCalled();

			// session が 'cancelled' に変わる
			mockState.sessionStatus = 'cancelled';
			expect(ctrl5.logicalState).toBe('stopped');

			// 再開
			const mockRestartFn = vi.fn().mockResolvedValue({ data: { topicId: 't1' } });
			vi.mocked(httpsCallable).mockReturnValue(mockRestartFn as never);
			await ctrl5.runRestart!();
			expect(httpsCallable).toHaveBeenCalledWith(
				expect.anything(),
				'restartDebate',
				expect.any(Object)
			);
			expect(mockRestartFn).toHaveBeenCalledWith({ topicId: 't1' });

			// session が 'debating' に戻る（Firestore更新をシミュレート）
			mockState.sessionStatus = 'debating';
			expect(ctrl5.logicalState).toBe('running');
		});

		it('開始→停止→最初からやり直し (regenerate) のシナリオ', async () => {
			// Phase 5 stopped 状態
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'cancelled';
			const ctrl5 = createPhaseController(5);

			expect(ctrl5.logicalState).toBe('stopped');

			// 最初からやり直し
			await ctrl5.runRegenerate();
			expect(mockTopicMethods.regenerateDebate).toHaveBeenCalled();

			// regenerateDebate の中で startDebate が呼ばれ session が 'debating' に戻る
			mockState.sessionStatus = 'debating';
			expect(ctrl5.logicalState).toBe('running');
		});
	});

	describe('中断後リロードで stopped/generated が正しく再調整される', () => {
		it('topic (5, running) + session cancelled → stopped として導出される', () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'cancelled';
			const ctrl5 = createPhaseController(5);
			expect(ctrl5.logicalState).toBe('stopped');
		});

		it('topic (5, running) + session completed → generated として導出される', () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'completed';
			const ctrl5 = createPhaseController(5);
			expect(ctrl5.logicalState).toBe('generated');
		});

		it('topic (5, running) + session debating → running として導出される', () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'debating';
			const ctrl5 = createPhaseController(5);
			expect(ctrl5.logicalState).toBe('running');
		});
	});

	describe('実行中ガード: running 状態での操作は無視される', () => {
		it('フェーズ5 running 中は runGenerate/runRegenerate/runRestart が実行されない', async () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			mockState.sessionStatus = 'debating';
			const ctrl5 = createPhaseController(5);

			await ctrl5.runGenerate();
			await ctrl5.runRegenerate();
			await ctrl5.runRestart?.();

			expect(mockTopicMethods.startDebate).not.toHaveBeenCalled();
			expect(mockTopicMethods.regenerateDebate).not.toHaveBeenCalled();
			expect(httpsCallable).not.toHaveBeenCalled();
		});
	});
});
