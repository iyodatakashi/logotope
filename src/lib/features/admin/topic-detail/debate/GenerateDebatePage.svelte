<script lang="ts">
	import { Checkbox } from '@14ch/svelte-ui';
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath, nextPhase } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import DebateChapterIndex from './DebateChapterIndex.svelte';
	import DebateChapter from './DebateChapter.svelte';

	const PHASE: PhaseSlug = 'debate';
	// 押下直後の楽観的な「実行中」表示用フラグ。討論は running をサーバが書くため
	// callable 往復のあいだ表示が変わらない。その間を埋める表示専用のフラグ。
	// isResetting はやり直し時に旧ターンを即時非表示にする（再開はターンを引き継ぐので消さない）。
	let isStarting = $state(false);
	let isResetting = $state(false);
	// 討論を1章で終了するか最後の章まで続けるかの制御。開始/再開/やり直し時にサーバへ渡す。
	let singleChapterMode = $state(false);

	const generate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.startDebate(singleChapterMode);
		} finally {
			isStarting = false;
		}
	};
	const stop = () => currentTopicStore.topic?.stopDebate();
	const restart = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.restartDebate(singleChapterMode);
		} finally {
			isStarting = false;
		}
	};

	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		isResetting = true;
		try {
			// 討論をやり直すと下流の編集成果物も陳腐化するため破棄する。
			// startDebate を最後に呼ぶことで phase が debate へ戻る（resetEditing の phase 書込より後勝ち）。
			await topic.resetDebate();
			await topic.resetEditing();
			await topic.startDebate(singleChapterMode);
		} finally {
			isStarting = false;
			isResetting = false;
		}
	};

	// 討論を確定して編集フェーズへ前進する。generated のときのみ PhasePanel が表示する。
	const approve = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await topic.approveDebate();
		const next = nextPhase(PHASE);
		if (next) goto(phasePath(topic.id, next));
	};

	const logicalState = $derived.by(() => {
		if (isStarting) return 'running';
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});

	// 実状態(running)がトピックに反映されたら楽観フラグを解除し、以降は実状態に委ねる。
	$effect(() => {
		const topic = currentTopicStore.topic;
		if (
			topic &&
			phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE) === 'running'
		) {
			isStarting = false;
			isResetting = false;
		}
	});

	// 章ごとにターンを DebateChapter へ渡す。話者名/役割・指名先・engagements・気づきは型に畳まず、
	// 各コンポーネントが store（personaMap・engagementsMap・getAwarenessesByTurn）や id 参照から描画時に解決する。
	const hasTurns = $derived(
		currentTopicStore.chaptersStore.chapters.some(
			(chapter) => chapter.turns.length > 0 || chapter.pendingTurn
		)
	);
</script>

<PhasePanel
	{logicalState}
	title="フェーズ 5: 討論"
	generateLabel="討論を開始する"
	regenerateLabel="最初からやり直す"
	regenerateConfirm={{
		title: '討論を最初からやり直しますか？',
		description: '現在の討論内容と、生成済みの編集がすべて削除され、最初から討論し直します。',
		submitLabel: '最初からやり直す'
	}}
	stopLabel="討論を停止する"
	restartLabel="討論を再開する"
	approveLabel="討論を確定して編集へ"
	onGenerate={generate}
	onRegenerate={regenerate}
	onStop={stop}
	onRestart={restart}
	onApprove={approve}
>
	{#snippet headerControls()}
		<Checkbox bind:value={singleChapterMode}>1章で討論を終了する</Checkbox>
	{/snippet}
	{#snippet content()}
		<div class="generate-debate-page__content">
			<div class="generate-debate-page__chapter-index">
				{#if currentTopicStore.chaptersStore.chapters.length}
					<DebateChapterIndex
						chapters={currentTopicStore.chaptersStore.chapters}
						currentChapter={currentTopicStore.chaptersStore.currentChapter}
					/>
				{/if}
			</div>

			<div class="generate-debate-page__chapters">
				{#if !isResetting && hasTurns}
					{#each currentTopicStore.chaptersStore.chapters as chapter (chapter.id)}
						{#if chapter.turns.length > 0 || chapter.pendingTurn}
							<DebateChapter {chapter} />
						{/if}
					{/each}
				{/if}
			</div>
		</div>
	{/snippet}
</PhasePanel>

<style>
	.generate-debate-page__content {
		display: grid;
		grid-template-columns: 1fr 3fr;
		gap: 24px;
	}

	.generate-debate-page__chapter-index {
		position: sticky;
		align-self: start;
		top: 84px;
		min-width: 240px;
	}

	.generate-debate-page__chapters {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
</style>
