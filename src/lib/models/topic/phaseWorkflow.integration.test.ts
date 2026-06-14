/**
 * フェーズワークフロー結合テスト
 *
 * 承認連鎖・再生成・討論ライフサイクルのシナリオを通じて、
 * 操作群（phaseActions）と純粋な状態導出（phaseLogicalState）が
 * トピックの (phase, phaseStatus) のみで一貫して動作することを検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { phaseLogicalState } from '$lib/utils/phase.js';
import type { Phase, PhaseStatus } from '$lib/utils/phase.js';
import type { PersonaDoc } from '$lib/models/persona/persona.types.js';

const { mockState, mockTopicMethods, mockPersonasMethods } = vi.hoisted(() => ({
	mockState: {
		topicPhase: 1 as Phase,
		topicPhaseStatus: 'not_started' as PhaseStatus,
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
			return {
				id: 't1',
				title: 'テスト',
				phase: mockState.topicPhase,
				phaseStatus: mockState.topicPhaseStatus,
				...mockTopicMethods
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
import { phaseActions } from './phaseActions.js';

// 現在のトピック状態から対象フェーズの論理状態を導出するヘルパー
const stateOf = (target: Phase) =>
	phaseLogicalState({ phase: mockState.topicPhase, phaseStatus: mockState.topicPhaseStatus }, target);

describe('フェーズワークフロー結合テスト', () => {
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
		mockState.topicPhase = 1;
		mockState.topicPhaseStatus = 'not_started';
		mockState.personas = [];
		mockState.topicExists = true;
	});

	describe('承認連鎖: フェーズ1→5 で2軸が順次遷移する', () => {
		it('フェーズ1承認後: フェーズ1は approved、フェーズ2は not_started になる', async () => {
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'generated';

			expect(stateOf(1)).toBe('generated');
			expect(stateOf(2)).toBe('not_started');

			await phaseActions.approve(1);
			expect(mockTopicMethods.approveStakeholders).toHaveBeenCalled();
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/personas');

			// Firestore 書き込みをシミュレート: (2, not_started) へ前進
			mockState.topicPhase = 2;
			mockState.topicPhaseStatus = 'not_started';

			expect(stateOf(1)).toBe('approved');
			expect(stateOf(2)).toBe('not_started');
		});

		it('フェーズ3→4→5 の承認連鎖が正しい goto を呼ぶ', async () => {
			mockState.topicPhase = 3;
			mockState.topicPhaseStatus = 'generated';
			await phaseActions.approve(3);
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/chapters');

			mockState.topicPhase = 4;
			mockState.topicPhaseStatus = 'generated';
			await phaseActions.approve(4);
			expect(goto).toHaveBeenCalledWith('/admin/topics/t1/debate');

			// フェーズ5は承認なし: no-op
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'generated';
			await phaseActions.approve(5);
			expect(goto).toHaveBeenCalledTimes(2);
		});
	});

	describe('中間フェーズ再生成: 下流フェーズは not_started として扱われる', () => {
		it('フェーズ1再生成後: フェーズ2以降は not_started として表示される', async () => {
			mockState.topicPhase = 3;
			mockState.topicPhaseStatus = 'generated';

			expect(stateOf(1)).toBe('approved');
			expect(stateOf(2)).toBe('approved');
			expect(stateOf(3)).toBe('generated');

			await phaseActions.regenerate(1);
			expect(mockTopicMethods.generateStakeholders).toHaveBeenCalled();

			// (1, generated) へ巻き戻し
			mockState.topicPhase = 1;
			mockState.topicPhaseStatus = 'generated';

			expect(stateOf(1)).toBe('generated');
			expect(stateOf(2)).toBe('not_started');
			expect(stateOf(3)).toBe('not_started');
		});

		it('フェーズ3再生成: 取材セッション破棄と全ペルソナ再取材を呼ぶ', async () => {
			mockState.topicPhase = 4;
			mockState.topicPhaseStatus = 'not_started';

			await phaseActions.regenerate(3);
			expect(mockTopicMethods.clearDebateSession).toHaveBeenCalled();
			expect(mockPersonasMethods.runInterviews).toHaveBeenCalledWith('テスト', true);
		});
	});

	describe('討論ライフサイクル: 開始→停止→再開（トピック状態のみ）', () => {
		it('開始→停止→再開のシナリオで状態が正しく遷移する', async () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'not_started';

			expect(stateOf(5)).toBe('not_started');
			await phaseActions.generate(5);
			expect(mockTopicMethods.startDebate).toHaveBeenCalled();

			// Firestore が (5, running) に更新
			mockState.topicPhaseStatus = 'running';
			expect(stateOf(5)).toBe('running');

			// 停止: トピックを stopped にする
			await phaseActions.stopDebate();
			expect(mockTopicMethods.stopDebate).toHaveBeenCalled();
			mockState.topicPhaseStatus = 'stopped';
			expect(stateOf(5)).toBe('stopped');

			// 再開
			const mockRestartFn = vi.fn().mockResolvedValue({ data: { topicId: 't1' } });
			vi.mocked(httpsCallable).mockReturnValue(mockRestartFn as never);
			await phaseActions.restartDebate();
			expect(mockRestartFn).toHaveBeenCalledWith({ topicId: 't1' });

			// (5, running) に戻る
			mockState.topicPhaseStatus = 'running';
			expect(stateOf(5)).toBe('running');
		});

		it('開始→停止→最初からやり直し (regenerate) のシナリオ', async () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'stopped';

			expect(stateOf(5)).toBe('stopped');

			await phaseActions.regenerate(5);
			expect(mockTopicMethods.regenerateDebate).toHaveBeenCalled();

			mockState.topicPhaseStatus = 'running';
			expect(stateOf(5)).toBe('running');
		});
	});

	describe('リロードでもトピックのみから状態が復元される', () => {
		it('topic (5, stopped) → stopped として導出される', () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'stopped';
			expect(stateOf(5)).toBe('stopped');
		});

		it('topic (5, generated) → generated として導出される', () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'generated';
			expect(stateOf(5)).toBe('generated');
		});

		it('topic (5, running) → running として導出される', () => {
			mockState.topicPhase = 5;
			mockState.topicPhaseStatus = 'running';
			expect(stateOf(5)).toBe('running');
		});
	});
});
