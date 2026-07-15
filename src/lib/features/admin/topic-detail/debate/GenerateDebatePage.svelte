<script lang="ts">
	import { Button, ConfirmDialog } from '@14ch/svelte-ui';
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import DebateChapterIndex from './DebateChapterIndex.svelte';
	import DebateChapter from './DebateChapter.svelte';

	const PHASE: PhaseSlug = 'debate';
	// 押下直後の楽観的な「実行中」表示用フラグ。討論は running をサーバが書くため
	// callable 往復のあいだ表示が変わらない。その間を埋める表示専用のフラグ。
	// isResetting はやり直し時に旧ターンを即時非表示にする。
	let isStarting = $state(false);
	let isResetting = $state(false);
	// 「次に進む」押下中の loading・多重押下抑止と、承認失敗時のエラー表示。
	let isApproving = $state(false);
	let approveError = $state('');

	let regenerateDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();

	const generate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.startDebate();
		} finally {
			isStarting = false;
		}
	};
	const stop = () => currentTopicStore.topic?.stopDebate();

	// 最初からやり直す: サーバ権威の単一操作を1回呼ぶだけ（debate 確定→討論付随データ＋下流編集破棄→開始をサーバが所有）。
	// 停止・生成済み・前進済みのいずれからも最初から生成し直す（部分継続の「再開する」は提供しない）。
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		// 押下直後に旧ターンを即時非表示にする（実削除はサーバが権威的に行う）。解除は実同期に連動（下記 $effect）。
		isResetting = true;
		try {
			await topic.startDebate();
		} catch (err) {
			// 対象フェーズへ到達しない失敗（手順1前）では固着を防ぐため即時に解除する。
			isResetting = false;
			throw err;
		} finally {
			isStarting = false;
		}
	};

	const logicalState = $derived.by(() => {
		if (isStarting) return 'running';
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});

	const handleBackClick = () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		goto(phasePath(topic.id, 'chapters'));
	};

	// 承認を「次に進む」に畳み込む。討論生成完了で活性。未承認なら討論を確定してから編集画面へ遷移し、
	// 失敗時は遷移せずエラーを表示する。
	const canAdvance = $derived(logicalState === 'generated' || logicalState === 'approved');
	const handleForwardClick = async () => {
		const topic = currentTopicStore.topic;
		if (!topic || !canAdvance) return;
		isApproving = true;
		approveError = '';
		try {
			if (logicalState !== 'approved') await topic.approveDebate();
			goto(phasePath(topic.id, 'editing'));
		} catch {
			approveError = '討論の確定に失敗しました。時間をおいて再試行してください。';
		} finally {
			isApproving = false;
		}
	};

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
		<div class="generate-debate-page__actions">
			<Button variant="outlined" icon="arrow_back" rounded onclick={handleBackClick}>
				前に戻る
			</Button>
			{#if logicalState === 'not_started'}
				<Button variant="filled" rounded icon="cached" onclick={generate}>討論を開始する</Button>
			{:else if logicalState === 'running'}
				<Button variant="outlined" rounded onclick={stop}>討論を停止する</Button>
			{:else}
				<Button variant="ghost" rounded icon="cached" onclick={() => regenerateDialog?.open()}>
					最初からやり直す
				</Button>
			{/if}
			<div class="generate-debate-page__forward">
				<Button
					variant="filled"
					icon="arrow_forward"
					iconPosition="right"
					rounded
					loading={isApproving}
					disabled={!canAdvance}
					onclick={handleForwardClick}
				>
					次に進む
				</Button>
				{#if approveError}
					<p class="generate-debate-page__error" role="alert">{approveError}</p>
				{/if}
			</div>
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
	.generate-debate-page__actions {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}

	.generate-debate-page__forward {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.generate-debate-page__error {
		color: var(--svelte-ui-error-color);
		font-size: var(--svelte-ui-font-size-sm);
	}

	.generate-debate-page__content {
		display: grid;
		grid-template-columns: 1fr 3fr;
		gap: 24px;
		max-width: 960px;
		margin: 0 auto;
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
