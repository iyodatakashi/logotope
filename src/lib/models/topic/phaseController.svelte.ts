import { goto } from '$app/navigation';
import { httpsCallable } from 'firebase/functions';
import { functions } from '$lib/firebase.js';
import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
import { PHASE_DEFS, phaseLogicalState, phasePath } from '$lib/utils/phase.js';
import type { Phase, PhaseLogicalState } from '$lib/utils/phase.js';

export interface PhaseController {
	readonly phase: Phase;
	readonly logicalState: PhaseLogicalState;
	readonly inFlight: boolean;
	readonly error: string | null;
	runGenerate(): Promise<void>;
	runApprove(): Promise<void>;
	runRegenerate(): Promise<void>;
	runStop?(): Promise<void>;
	runRestart?(): Promise<void>;
	clearError(): void;
}

export const createPhaseController = (targetPhase: Phase): PhaseController => {
	const def = PHASE_DEFS.find((d) => d.phase === targetPhase)!;

	let inFlight = $state(false);
	let error = $state<string | null>(null);

	const getLogicalState = (): PhaseLogicalState => {
		const topic = currentTopicStore.topic;
		if (!topic?.phase) return 'not_started';
		const current = { phase: topic.phase, phaseStatus: topic.phaseStatus ?? 'not_started' };
		const session = currentTopicStore.sessionStore.session;
		return phaseLogicalState(current, targetPhase, {
			sessionStatus: session?.status,
			debateComplete: session?.status === 'completed',
			clientPhaseInFlight: inFlight
		});
	};

	const exec = async (op: () => Promise<void>): Promise<void> => {
		inFlight = true;
		error = null;
		try {
			await op();
		} catch (e) {
			error = e instanceof Error ? e.message : '処理に失敗しました';
		} finally {
			inFlight = false;
		}
	};

	const doGenerate = async (): Promise<void> => {
		const topic = currentTopicStore.topic;
		if (!topic) throw new Error('トピックが見つかりません');
		switch (targetPhase) {
			case 1:
				await topic.generateStakeholders();
				break;
			case 2:
				await topic.generatePersonas();
				break;
			case 3: {
				const pStore = currentTopicStore.personasStore;
				await pStore.markInterviewsStarted();
				const pending = pStore.personas.filter((p) => p.interview?.status !== 'completed');
				await Promise.all(pending.map((p) => pStore.runInterview(p.id, topic.title)));
				await pStore.markInterviewsComplete();
				break;
			}
			case 4:
				await topic.generateChapters();
				break;
			case 5:
				await topic.startDebate();
				break;
		}
	};

	const doApprove = async (): Promise<void> => {
		const topic = currentTopicStore.topic;
		if (!topic) throw new Error('トピックが見つかりません');
		const topicId = topic.id;
		switch (targetPhase) {
			case 1:
				await topic.approveStakeholders();
				break;
			case 2:
				await currentTopicStore.personasStore.approvePersonas();
				break;
			case 3:
				await topic.approveInterviews();
				break;
			case 4:
				await topic.approveChapters();
				break;
		}
		goto(phasePath(topicId, (targetPhase + 1) as Phase));
	};

	const doRegenerate = async (): Promise<void> => {
		const topic = currentTopicStore.topic;
		if (!topic) throw new Error('トピックが見つかりません');
		switch (targetPhase) {
			case 1:
				await topic.generateStakeholders();
				break;
			case 2:
				await topic.generatePersonas();
				break;
			case 3: {
				await topic.clearDebateSession();
				const pStore = currentTopicStore.personasStore;
				await pStore.markInterviewsStarted();
				await Promise.all(pStore.personas.map((p) => pStore.runInterview(p.id, topic.title)));
				await pStore.markInterviewsComplete();
				break;
			}
			case 4:
				await topic.generateChapters();
				break;
			case 5:
				await topic.regenerateDebate();
				break;
		}
	};

	const runGenerate = (): Promise<void> => {
		if (inFlight || getLogicalState() !== 'not_started') return Promise.resolve();
		return exec(doGenerate);
	};

	const runApprove = (): Promise<void> => {
		if (!def.forwardAction || inFlight || getLogicalState() !== 'generated') return Promise.resolve();
		return exec(doApprove);
	};

	const runRegenerate = (): Promise<void> => {
		const state = getLogicalState();
		if (inFlight || state === 'running' || state === 'not_started') return Promise.resolve();
		return exec(doRegenerate);
	};

	const runStop = def.stoppable
		? (): Promise<void> => {
				if (inFlight || getLogicalState() !== 'running') return Promise.resolve();
				return exec(async () => {
					await currentTopicStore.topic?.cancelDebate();
				});
			}
		: undefined;

	const runRestart = def.restartable
		? (): Promise<void> => {
				if (inFlight || getLogicalState() !== 'stopped') return Promise.resolve();
				return exec(async () => {
					const topic = currentTopicStore.topic;
					if (!topic) throw new Error('トピックが見つかりません');
					const fn = httpsCallable<{ topicId: string }, { topicId: string }>(
						functions,
						'restartDebate',
						{ timeout: 60000 }
					);
					await fn({ topicId: topic.id });
				});
			}
		: undefined;

	const clearError = (): void => {
		error = null;
	};

	return {
		get phase() {
			return targetPhase;
		},
		get logicalState() {
			return getLogicalState();
		},
		get inFlight() {
			return inFlight;
		},
		get error() {
			return error;
		},
		runGenerate,
		runApprove,
		runRegenerate,
		...(runStop ? { runStop } : {}),
		...(runRestart ? { runRestart } : {}),
		clearError
	};
};
