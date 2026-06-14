import { goto } from '$app/navigation';
import { httpsCallable } from 'firebase/functions';
import { functions } from '$lib/firebase.js';
import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
import { phasePath } from '$lib/utils/phase.js';
import type { Phase } from '$lib/utils/phase.js';

// フェーズ操作群: 実行中フラグ・論理状態を保持しない。状態の権威はトピックのみ。
// 各操作はトピックストア／ペルソナストアのメソッドを呼び、結果は (phase, phaseStatus) に反映される。

const generate = async (phase: Phase): Promise<void> => {
	const topic = currentTopicStore.topic;
	if (!topic) return;
	switch (phase) {
		case 1:
			await topic.generateStakeholders();
			break;
		case 2:
			await topic.generatePersonas();
			break;
		case 3:
			await currentTopicStore.personasStore.runInterviews(topic.title);
			break;
		case 4:
			await topic.generateChapters();
			break;
		case 5:
			await topic.startDebate();
			break;
	}
};

const approve = async (phase: Phase): Promise<void> => {
	const topic = currentTopicStore.topic;
	if (!topic) return;
	const topicId = topic.id;
	switch (phase) {
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
		default:
			return;
	}
	goto(phasePath(topicId, (phase + 1) as Phase));
};

const regenerate = async (phase: Phase): Promise<void> => {
	const topic = currentTopicStore.topic;
	if (!topic) return;
	switch (phase) {
		case 1:
			await topic.generateStakeholders();
			break;
		case 2:
			await topic.generatePersonas();
			break;
		case 3:
			await topic.clearDebateSession();
			await currentTopicStore.personasStore.runInterviews(topic.title, true);
			break;
		case 4:
			await topic.generateChapters();
			break;
		case 5:
			await topic.regenerateDebate();
			break;
	}
};

// 討論の停止: トピックのフェーズ状態を停止にする。
const stopDebate = async (): Promise<void> => {
	await currentTopicStore.topic?.stopDebate();
};

// 停止した討論を currentChapterIndex から再開する。
const restartDebate = async (): Promise<void> => {
	const topic = currentTopicStore.topic;
	if (!topic) return;
	const fn = httpsCallable<{ topicId: string }, { topicId: string }>(functions, 'restartDebate', {
		timeout: 60000
	});
	await fn({ topicId: topic.id });
};

// running 固着・stopped からの再実行（フェーズ1〜4）。生成と同じ経路で回復する。
const retry = (phase: Phase): Promise<void> => generate(phase);

export const phaseActions = {
	generate,
	approve,
	regenerate,
	stopDebate,
	restartDebate,
	retry
};
