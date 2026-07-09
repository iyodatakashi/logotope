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

	const personaMap = $derived(
		new Map(currentTopicStore.personasStore.personas.map((persona) => [persona.id, persona]))
	);

	// 章ごとにターンを DebateChapter へ渡す。話者名/役割・指名先・engagements・気づきは型に畳まず、
	// personaMap や id 参照で描画時に解決する（編集画面の ChapterSection と責務境界・粒度をそろえる）。
	const engagementsMap = $derived(currentTopicStore.engagementsStore.engagementsMap);
	const hasTurns = $derived(
		currentTopicStore.chaptersStore.chapters.some((chapter) => chapter.turns.length > 0)
	);

	// 原本ターン id → そのターンを聞いて各ペルソナが得た気づき（triggeredByTurnId で紐づく）。
	// 話者名は畳まず personaId 参照のまま保持し、描画時に personaMap で解決する。
	const awarenessesByTurn = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, { personaId: string; content: string }[]>();
		for (const persona of currentTopicStore.personasStore.personas) {
			for (const awareness of persona.awarenesses ?? []) {
				map.set(awareness.triggeredByTurnId, [
					...(map.get(awareness.triggeredByTurnId) ?? []),
					{ personaId: persona.id, content: awareness.content }
				]);
			}
		}
		return map;
	});
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
		{#if currentTopicStore.chaptersStore.chapters.length}
			<DebateChapterIndex
				chapters={currentTopicStore.chaptersStore.chapters}
				currentChapter={currentTopicStore.chaptersStore.currentChapter}
			/>
		{/if}

		{#if !isResetting && hasTurns}
			<div class="generate-debate-page__chapters-turns">
				{#each currentTopicStore.chaptersStore.chapters as chapter (chapter.id)}
					{#if chapter.turns.length > 0}
						<DebateChapter
							title={chapter.title}
							turns={chapter.turns}
							{personaMap}
							{engagementsMap}
							{awarenessesByTurn}
						/>
					{/if}
				{/each}
			</div>
		{/if}
	{/snippet}
</PhasePanel>

<style>
	.generate-debate-page__chapters-turns {
		display: flex;
		flex-direction: column;
		gap: 24px;
		margin-top: 8px;
	}
</style>
