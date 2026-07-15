<script lang="ts">
	import { Button, Checkbox, ConfirmDialog } from '@14ch/svelte-ui';
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

	let regenerateDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();

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
		// 押下直後に旧ターンを即時非表示にする（実削除はサーバが権威的に行う）。解除は実同期に連動（下記 $effect）。
		isResetting = true;
		try {
			// サーバ権威の単一操作を1回呼ぶだけ（debate 確定→討論付随データ＋下流編集破棄→開始をサーバが所有）。
			await topic.startDebate(singleChapterMode);
		} catch (err) {
			// 対象フェーズへ到達しない失敗（手順1前）では固着を防ぐため即時に解除する。
			isResetting = false;
			throw err;
		} finally {
			isStarting = false;
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

	// 実状態(running)がトピックに反映されたら楽観フラグ（実行中表示）を解除し、以降は実状態に委ねる。
	$effect(() => {
		const topic = currentTopicStore.topic;
		if (
			topic &&
			phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE) === 'running'
		) {
			isStarting = false;
		}
	});

	// 章ごとにターンを DebateChapter へ渡す。話者名/役割・指名先・engagements・気づきは型に畳まず、
	// 各コンポーネントが store（personaMap・engagementsMap・getAwarenessesByTurn）や id 参照から描画時に解決する。
	const hasTurns = $derived(
		currentTopicStore.chaptersStore.chapters.some(
			(chapter) => chapter.turns.length > 0 || chapter.pendingTurn
		)
	);

	// isResetting（旧ターン非表示）の解除は実同期に連動: サーバが対象フェーズ（debate）を running/stopped に
	// 確定し（下流の完了表示が消え）、かつ旧ターンが実削除された（!hasTurns）ときに解除する。呼び出し完了（finally）
	// では解除しない。generated 起点のやり直しでは実状態がまだ generated のままなので旧ターン表示が保たれ、
	// 往復後の一瞬の旧ターン再表示を防ぐ。
	$effect(() => {
		const topic = currentTopicStore.topic;
		if (!isResetting || !topic) return;
		const real = phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE);
		if ((real === 'running' || real === 'stopped') && !hasTurns) {
			isResetting = false;
		}
	});
</script>

<PhasePanel>
	{#snippet actions()}
		<div class="generate-debate-page__actions-row">
			<div class="generate-debate-page__actions">
				{#if logicalState === 'not_started'}
					<Button variant="filled" onclick={generate}>討論を開始する</Button>
				{:else if logicalState === 'running'}
					<Button variant="outlined" onclick={stop}>討論を停止する</Button>
				{:else if logicalState === 'stopped'}
					<Button variant="filled" onclick={restart}>討論を再開する</Button>
					<Button variant="filled" onclick={() => regenerateDialog?.open()}>最初からやり直す</Button
					>
				{:else if logicalState === 'generated'}
					<Button variant="filled" onclick={() => regenerateDialog?.open()}>最初からやり直す</Button
					>
					<Button variant="filled" onclick={approve}>討論を確定して編集へ</Button>
				{:else if logicalState === 'approved'}
					<Button variant="filled" onclick={() => regenerateDialog?.open()}>最初からやり直す</Button
					>
				{/if}
			</div>
			<Checkbox bind:value={singleChapterMode}>1章で討論を終了する</Checkbox>
		</div>
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

<ConfirmDialog
	bind:this={regenerateDialog}
	title="討論を最初からやり直しますか？"
	description="現在の討論内容と、生成済みの編集がすべて削除され、最初から討論し直します。"
	danger
	submitLabel="最初からやり直す"
	cancelLabel="キャンセル"
	onSubmit={regenerate}
/>

<style>
	.generate-debate-page__actions-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.generate-debate-page__actions {
		display: flex;
		gap: 8px;
	}

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
