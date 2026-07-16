<script lang="ts">
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import { Button, ConfirmDialog } from '@14ch/svelte-ui';

	const PHASE: PhaseSlug = 'chapters';

	let regenerateDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();
	// 「次に進む」押下中の loading・多重押下抑止と、承認失敗時のエラー表示。
	let isApproving = $state(false);
	let approveError = $state('');
	// 押下直後の楽観的な「実行中」表示用フラグ。サーバ権威のステータス書き込みには
	// 触れず、表示の即時フィードバックだけを担う。実状態(running)が反映されたら解除する。
	let isStarting = $state(false);
	// 再生成の表示専用フラグ。押下直後に旧章立て・付随分析を即時に隠す（実削除はサーバが権威的に行う）。
	// 解除は呼び出し完了ではなく実同期に連動させる（下記 $effect）。往復後の一瞬の旧データ再表示を防ぐ。
	let isRegenerating = $state(false);
	const logicalState = $derived.by(() => {
		if (isStarting) return 'running';
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});
	$effect(() => {
		const topic = currentTopicStore.topic;
		if (
			topic &&
			phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE) === 'running'
		) {
			isStarting = false;
		}
	});
	const chapters = $derived(
		currentTopicStore.chaptersStore.chapters.length
			? currentTopicStore.chaptersStore.chapters
			: null
	);
	const chapterIssues = $derived(currentTopicStore.chapterAnalysisStore.data);

	const generalIssues = $derived(
		chapterIssues?.issues?.filter((issue) => issue.source === 'general') ?? []
	);
	const personaIssues = $derived(
		chapterIssues?.issues?.filter((issue) => issue.source === 'persona') ?? []
	);
	const scoredIssues = $derived(
		chapterIssues?.issues
			?.filter((issue) => issue.score !== undefined)
			.toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0)) ?? []
	);

	// 再生成フラグの解除は実同期に連動: サーバが対象フェーズ（chapters）を running/stopped に確定し（下流の
	// 完了表示が消え）、かつ旧章立て・付随分析が実削除された（データ無し）ときに解除する。呼び出し完了（finally）
	// では解除しない。generated 起点の再生成では実状態がまだ generated のままなので旧データ表示が保たれ、
	// 往復後の一瞬の旧データ再表示を防ぐ。
	$effect(() => {
		const topic = currentTopicStore.topic;
		if (!isRegenerating || !topic) return;
		const real = phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE);
		const hasChapterData = chapters !== null || chapterIssues != null;
		if ((real === 'running' || real === 'stopped') && !hasChapterData) {
			isRegenerating = false;
		}
	});

	const generate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.generateChapters();
		} finally {
			isStarting = false;
		}
	};

	// 再生成: サーバ権威の単一操作を1回呼ぶだけ（対象フェーズ確定→章立て・付随分析＋下流破棄→生成をサーバが所有）。
	// 押下直後に isRegenerating で旧章立て・付随分析を即時に隠す（実削除の同期反映を待たない）。
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		isRegenerating = true;
		try {
			await topic.generateChapters();
		} catch (err) {
			// 対象フェーズへ到達しない失敗（手順1前）では固着を防ぐため即時に解除する。
			isRegenerating = false;
			throw err;
		} finally {
			isStarting = false;
		}
	};

	const handleBackClick = () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		goto(phasePath(topic.id, 'personas'));
	};

	// 承認を「次に進む」に畳み込む。章立て生成済みで活性。未承認なら承認してから討論画面へ遷移し、
	// 失敗時は遷移せずエラーを表示する。
	const canAdvance = $derived(logicalState === 'generated' || logicalState === 'approved');
	const handleForwardClick = async () => {
		const topic = currentTopicStore.topic;
		if (!topic || !canAdvance) return;
		isApproving = true;
		approveError = '';
		try {
			if (logicalState !== 'approved') await topic.approveChapters();
			goto(phasePath(topic.id, 'debate'));
		} catch {
			approveError = '章立ての承認に失敗しました。時間をおいて再試行してください。';
		} finally {
			isApproving = false;
		}
	};
</script>

<PhasePanel>
	{#snippet actions()}
		<div class="generate-chapters-page__actions">
			<Button variant="outlined" icon="arrow_back" rounded onclick={handleBackClick}>
				前に戻る
			</Button>
			{#if logicalState === 'running'}
				<Button variant="ghost" rounded icon="cached" loading onclick={() => {}}>
					アジェンダを生成する
				</Button>
			{:else if logicalState === 'not_started'}
				<Button variant="filled" rounded icon="cached" onclick={generate}>
					アジェンダを生成する
				</Button>
			{:else}
				<Button
					variant="filled"
					rounded
					icon="cached"
					color="var(--danger-color)"
					onclick={() => regenerateDialog?.open()}
				>
					アジェンダを再生成する
				</Button>
			{/if}
			<div class="generate-chapters-page__forward">
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
					<p class="generate-chapters-page__error" role="alert">{approveError}</p>
				{/if}
			</div>
		</div>
	{/snippet}

	{#snippet content()}
		<div class="generate-chapters-page__content">
			{#if !isStarting && !isRegenerating}
				{#if chapterIssues?.issues?.length}
					<section class="generate-chapters-page__issues">
						<h3>Step 1: 生成した切り口</h3>
						<div class="generate-chapters-page__issues-grid">
							<div class="generate-chapters-page__issues-col">
								<h4>一般的な切り口（ペルソナなし）</h4>
								<ol>
									{#each generalIssues as issue, i (issue.id ?? i)}
										<li>{issue.text}</li>
									{/each}
								</ol>
							</div>
							<div class="generate-chapters-page__issues-col">
								<h4>ペルソナ固有の切り口</h4>
								<ol>
									{#each personaIssues as issue, i (issue.id ?? i)}
										<li>{issue.text}</li>
									{/each}
								</ol>
							</div>
						</div>
					</section>
				{/if}
				{#if scoredIssues.length}
					<section class="generate-chapters-page__issues">
						<h3>Step 2: 論点スコアリング結果</h3>
						<ul class="generate-chapters-page__scored-issues">
							{#each scoredIssues as issue, i (issue.id ?? i)}
								<li
									class:generate-chapters-page__scored-issue--selected={issue.selected}
									class:generate-chapters-page__scored-issue--rejected={!issue.selected}
								>
									<span class="generate-chapters-page__score">{issue.score}</span>
									<span class="generate-chapters-page__issue-source"
										>{issue.source === 'general' ? '一般' : 'ペルソナ'}</span
									>
									<span class="generate-chapters-page__issue-text">{issue.text}</span>
									<span class="generate-chapters-page__reason">{issue.reason}</span>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				{#if chapterIssues?.issueGroups?.length}
					<section class="generate-chapters-page__issues">
						<h3>Step 3: グループ化結果</h3>
						<ul class="generate-chapters-page__grouping">
							{#each chapterIssues.issueGroups as group, i (i)}
								<li class="generate-chapters-page__group">
									<span class="generate-chapters-page__group-label">グループ {i + 1}</span>
									<ul class="generate-chapters-page__group-issues">
										{#each group.issueIndexes as issueIndex (issueIndex)}
											<li class="generate-chapters-page__group-issue">
												{chapterIssues.issues[issueIndex]?.text ?? ''}
											</li>
										{/each}
									</ul>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				{#if chapters}
					<section class="generate-chapters-page__issues">
						<h3>Step 4: 論点精査結果</h3>
						<ol class="generate-chapters-page__chapters">
							{#each chapters as chapter (chapter.id)}
								<li>
									<strong>{chapter.title}</strong>
									{#if chapter.agenda?.length}
										<ul class="generate-chapters-page__points">
											{#each chapter.agenda as point, i (i)}
												<li>{point}</li>
											{/each}
										</ul>
									{/if}
								</li>
							{/each}
						</ol>
					</section>
				{/if}
			{/if}
		</div>
	{/snippet}
</PhasePanel>

<ConfirmDialog
	bind:this={regenerateDialog}
	title="章立てを再生成しますか？"
	description="現在の章立てと、生成済みのデータ（討論・編集）が削除されます。"
	danger
	submitLabel="再生成する"
	cancelLabel="キャンセル"
	onSubmit={regenerate}
/>

<style>
	.generate-chapters-page__actions {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}

	.generate-chapters-page__forward {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.generate-chapters-page__error {
		color: var(--svelte-ui-error-color);
		font-size: var(--svelte-ui-font-size-sm);
	}

	.generate-chapters-page__content {
		max-width: 960px;
		margin: 0 auto;
	}

	.generate-chapters-page__chapters {
		margin: 16px 0;
		padding-left: 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.generate-chapters-page__chapters li {
		line-height: 1.5;
	}
	.generate-chapters-page__points {
		margin: 6px 0 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		list-style: disc;
	}
	.generate-chapters-page__points li {
		color: #888;
		line-height: 1.5;
	}
	.generate-chapters-page__issues {
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		padding: 12px;
	}
	.generate-chapters-page__issues h3 {
		margin: 0 0 12px;
	}
	.generate-chapters-page__issues-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		padding-bottom: 12px;
	}
	.generate-chapters-page__issues-col h4 {
		font-weight: bold;
	}

	.generate-chapters-page__issues-col ol {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.generate-chapters-page__scored-issues {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.generate-chapters-page__scored-issues li {
		display: grid;
		grid-template-columns: 2rem 3.5rem 1fr;
		grid-template-rows: auto auto;
		gap: 0 8px;
		padding: 6px 8px;
		border-radius: 4px;
	}
	.generate-chapters-page__scored-issues li.generate-chapters-page__scored-issue--selected {
		background: #e8f5e9;
	}
	.generate-chapters-page__scored-issues li.generate-chapters-page__scored-issue--rejected {
		background: #fafafa;
		opacity: 0.6;
	}
	.generate-chapters-page__score {
		grid-row: 1 / 3;
		align-self: center;
		text-align: center;
	}
	.generate-chapters-page__scored-issue--selected .generate-chapters-page__score {
		color: #2e7d32;
	}
	.generate-chapters-page__scored-issue--rejected .generate-chapters-page__score {
		color: #9e9e9e;
	}
	.generate-chapters-page__issue-source {
		color: #757575;
		align-self: end;
	}
	.generate-chapters-page__issue-text {
		color: #212121;
	}
	.generate-chapters-page__reason {
		grid-column: 3;
	}

	.generate-chapters-page__grouping {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.generate-chapters-page__group {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.generate-chapters-page__group-label {
		font-weight: bold;
	}
	.generate-chapters-page__group-issues {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.generate-chapters-page__group-issue {
		font-weight: normal;
	}
</style>
