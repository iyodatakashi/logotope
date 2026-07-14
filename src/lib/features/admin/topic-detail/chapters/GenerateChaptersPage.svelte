<script lang="ts">
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath, nextPhase } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import { Button, ConfirmDialog } from '@14ch/svelte-ui';

	const PHASE: PhaseSlug = 'chapters';

	let regenerateDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();
	// 押下直後の楽観的な「実行中」表示用フラグ。サーバ権威のステータス書き込みには
	// 触れず、表示の即時フィードバックだけを担う。実状態(running)が反映されたら解除する。
	let isStarting = $state(false);
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

	// 再生成: 章立てと下流（討論・編集）を破棄してから作り直す。
	// isStarting で押下直後に「実行中」表示へ切り替え、旧データを隠す（リセット完了を待たない）。
	// generateChapters を最後に呼ぶことで phase が chapters へ戻る（resetEditing の phase 書込より後勝ち）。
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.resetChapters();
			await topic.resetDebate();
			await topic.resetEditing();
			await topic.generateChapters();
		} finally {
			isStarting = false;
		}
	};

	const approve = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await topic.approveChapters();
		const next = nextPhase(PHASE);
		if (next) goto(phasePath(topic.id, next));
	};
</script>

<PhasePanel>
	{#snippet actions()}
		<div class="generate-chapters-page__actions">
			{#if logicalState === 'not_started'}
				<Button variant="filled" onclick={generate}>章立てを生成する</Button>
			{:else if logicalState === 'running'}
				<Button variant="filled" loading onclick={generate}>章立てを生成する</Button>
			{:else if logicalState === 'generated'}
				<Button variant="filled" onclick={() => regenerateDialog?.open()}>再生成する</Button>
				<Button variant="filled" onclick={approve}>承認して次へ進む</Button>
			{:else if logicalState === 'approved'}
				<Button variant="filled" onclick={() => regenerateDialog?.open()}>再生成する</Button>
			{/if}
		</div>
	{/snippet}

	{#snippet content()}
		<div class="generate-chapters-page__content">
			{#if !isStarting}
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
		flex-wrap: wrap;
		gap: 8px;
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
