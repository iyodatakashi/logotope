<script lang="ts">
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath, nextPhase } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';

	const PHASE: PhaseSlug = 'chapters';
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

<PhasePanel
	{logicalState}
	title="フェーズ 4: 章立て"
	generateLabel="章立てを生成する"
	approveLabel="承認して次へ進む"
	regenerateLabel="再生成する"
	regenerateConfirm={{
		title: '章立てを再生成しますか？',
		description: '現在の章立てと、生成済みのデータ（討論・編集）が削除されます。',
		submitLabel: '再生成する'
	}}
	onGenerate={generate}
	onApprove={approve}
	onRegenerate={regenerate}
>
	{#snippet content()}
		{#if !isStarting}
			{#if chapterIssues?.issues?.length}
				<section class="phase4-chapters__issues">
					<h3>Step 1: 生成した切り口</h3>
					<div class="phase4-chapters__issues-grid">
						<div class="phase4-chapters__issues-col">
							<h4>一般的な切り口（ペルソナなし）</h4>
							<ol>
								{#each generalIssues as issue, i (issue.id ?? i)}
									<li>{issue.text}</li>
								{/each}
							</ol>
						</div>
						<div class="phase4-chapters__issues-col">
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
				<section class="phase4-chapters__issues">
					<h3>Step 2: 論点スコアリング結果</h3>
					<ul class="phase4-chapters__scored-issues">
						{#each scoredIssues as issue, i (issue.id ?? i)}
							<li
								class:phase4-chapters__scored-issue--selected={issue.selected}
								class:phase4-chapters__scored-issue--rejected={!issue.selected}
							>
								<span class="phase4-chapters__score">{issue.score}</span>
								<span class="phase4-chapters__issue-source"
									>{issue.source === 'general' ? '一般' : 'ペルソナ'}</span
								>
								<span class="phase4-chapters__issue-text">{issue.text}</span>
								<span class="phase4-chapters__reason">{issue.reason}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
			{#if chapterIssues?.issueGroups?.length}
				<section class="phase4-chapters__issues">
					<h3>Step 3: グループ化結果</h3>
					<ul class="phase4-chapters__grouping">
						{#each chapterIssues.issueGroups as group, i (i)}
							<li class="phase4-chapters__group">
								<span class="phase4-chapters__group-label">グループ {i + 1}</span>
								<ul class="phase4-chapters__group-issues">
									{#each group.issueIndexes as issueIndex (issueIndex)}
										<li class="phase4-chapters__group-issue">
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
				<section class="phase4-chapters__issues">
					<h3>Step 4: 論点精査結果</h3>
					<ol class="phase4-chapters__chapters">
						{#each chapters as chapter (chapter.id)}
							<li>
								<strong>{chapter.title}</strong>
								{#if chapter.discussionPoints?.length}
									<ul class="phase4-chapters__points">
										{#each chapter.discussionPoints as point, i (i)}
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
	{/snippet}
</PhasePanel>

<style>
	.phase4-chapters__chapters {
		margin: 16px 0;
		padding-left: 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.phase4-chapters__chapters li {
		line-height: 1.5;
	}
	.phase4-chapters__points {
		margin: 6px 0 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		list-style: disc;
	}
	.phase4-chapters__points li {
		color: #888;
		line-height: 1.5;
	}
	.phase4-chapters__issues {
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		padding: 12px;
	}
	.phase4-chapters__issues h3 {
		margin: 0 0 12px;
	}
	.phase4-chapters__issues-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		padding-bottom: 12px;
	}
	.phase4-chapters__issues-col h4 {
		font-weight: bold;
	}

	.phase4-chapters__issues-col ol {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.phase4-chapters__scored-issues {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.phase4-chapters__scored-issues li {
		display: grid;
		grid-template-columns: 2rem 3.5rem 1fr;
		grid-template-rows: auto auto;
		gap: 0 8px;
		padding: 6px 8px;
		border-radius: 4px;
	}
	.phase4-chapters__scored-issues li.phase4-chapters__scored-issue--selected {
		background: #e8f5e9;
	}
	.phase4-chapters__scored-issues li.phase4-chapters__scored-issue--rejected {
		background: #fafafa;
		opacity: 0.6;
	}
	.phase4-chapters__score {
		grid-row: 1 / 3;
		align-self: center;
		text-align: center;
	}
	.phase4-chapters__scored-issue--selected .phase4-chapters__score {
		color: #2e7d32;
	}
	.phase4-chapters__scored-issue--rejected .phase4-chapters__score {
		color: #9e9e9e;
	}
	.phase4-chapters__issue-source {
		color: #757575;
		align-self: end;
	}
	.phase4-chapters__issue-text {
		color: #212121;
	}
	.phase4-chapters__reason {
		grid-column: 3;
	}

	.phase4-chapters__grouping {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.phase4-chapters__group {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.phase4-chapters__group-label {
		font-weight: bold;
	}
	.phase4-chapters__group-issues {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.phase4-chapters__group-issue {
		font-weight: normal;
	}
</style>
