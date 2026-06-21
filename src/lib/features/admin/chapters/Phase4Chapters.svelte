<script lang="ts">
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath } from '$lib/models/phase/phase';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';

	const PHASE = 4;
	const logicalState = $derived.by(() => {
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});
	const chapters = $derived(
		currentTopicStore.chaptersStore.chapters.length
			? currentTopicStore.chaptersStore.chapters
			: null
	);
	const chapterIssues = $derived(currentTopicStore.chapterAnalysisStore.data);

	const generalIssues = $derived(
		chapterIssues?.issues?.filter((i) => i.source === 'general') ?? []
	);
	const personaIssues = $derived(
		chapterIssues?.issues?.filter((i) => i.source === 'persona') ?? []
	);
	const scoredIssues = $derived(
		chapterIssues?.issues
			?.filter((i) => i.score !== undefined)
			.toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0)) ?? []
	);

	const generate = () => currentTopicStore.topic?.generateChapters();

	// 再生成: 章立てと下流（討論）を破棄してから作り直す
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await topic.resetChapters();
		await topic.resetDebate();
		await topic.generateChapters();
	};

	const approve = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await topic.approveChapters();
		goto(phasePath(topic.id, 5));
	};
</script>

<PhasePanel
	{logicalState}
	title="フェーズ 4: 章立て"
	generateHint="取材結果をもとに討論の章立てを生成します。"
	generateLabel="章立てを生成する"
	approveLabel="承認して次へ進む"
	regenerateLabel="再生成する"
	regenerateConfirm={{
		title: '章立てを再生成しますか？',
		description: '現在の章立てと、生成済みの討論が削除されます。',
		submitLabel: '再生成する'
	}}
	onGenerate={generate}
	onApprove={approve}
	onRegenerate={regenerate}
>
	{#snippet content()}
		{#if chapterIssues?.issues?.length}
			<section class="issues">
				<h3>Step 1: 生成した切り口</h3>
				<div class="issues-grid">
					<div class="issues-col">
						<h4>一般的な切り口（ペルソナなし）</h4>
						<ol>
							{#each generalIssues as issue (issue.text)}
								<li>{issue.text}</li>
							{/each}
						</ol>
					</div>
					<div class="issues-col">
						<h4>ペルソナ固有の切り口</h4>
						<ol>
							{#each personaIssues as issue (issue.text)}
								<li>{issue.text}</li>
							{/each}
						</ol>
					</div>
				</div>
			</section>
		{/if}
		{#if scoredIssues.length}
			<section class="issues">
				<h3>Step 2: 論点スコアリング結果</h3>
				<ul class="scored-issues">
					{#each scoredIssues as issue (issue.text)}
						<li class:selected={issue.selected} class:rejected={!issue.selected}>
							<span class="score">{issue.score}</span>
							<span class="issue-source">{issue.source === 'general' ? '一般' : 'ペルソナ'}</span>
							<span class="issue-text">{issue.text}</span>
							<span class="reason">{issue.reason}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
		{#if chapterIssues?.issueGroups?.length}
			<section class="issues">
				<h3>Step 3: グループ化結果</h3>
				<ul class="grouping">
					{#each chapterIssues.issueGroups as group, i (i)}
						<li class="group">
							<span class="group-label">グループ {i + 1}</span>
							<ul class="group-issues">
								{#each group.issueIndexes as idx (idx)}
									<li class="group-issue">{chapterIssues.issues[idx]?.text ?? ''}</li>
								{/each}
							</ul>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
		{#if chapters}
			<section class="issues">
				<h3>Step 4: 論点精査結果</h3>
				<ol class="chapters">
					{#each chapters as chapter (chapter.title)}
						<li>
							<strong>{chapter.title}</strong>
							{#if chapter.discussionPoints?.length}
								<ul class="points">
									{#each chapter.discussionPoints as point (point)}
										<li>{point}</li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ol>
			</section>
		{/if}
	{/snippet}
</PhasePanel>

<style>
	.chapters {
		margin: 16px 0;
		padding-left: 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.chapters li {
		line-height: 1.5;
	}
	.points {
		margin: 6px 0 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		list-style: disc;
	}
	.points li {
		font-size: 0.8rem;
		color: #888;
		line-height: 1.5;
	}
	.issues {
		margin-top: 24px;
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		padding: 12px;
	}
	.issues h3 {
		margin: 0 0 12px;
		font-size: 0.9rem;
		color: #555;
	}
	.issues-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		padding-bottom: 12px;
	}
	.issues-col h4 {
		font-size: 0.8rem;
		color: #555;
		margin: 0 0 8px;
		font-weight: 600;
	}
	.issues-col ol {
		margin: 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.issues-col li {
		font-size: 0.8rem;
		color: #444;
		line-height: 1.5;
	}
	.grouping {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.8rem;
		line-height: 1.6;
	}
	.group-label {
		font-weight: 700;
		color: #1565c0;
	}
	.group-issues {
		margin: 0;
		padding-left: 16px;
		list-style: disc;
		color: #333;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.group-issue {
		line-height: 1.5;
	}
	.scored-issues {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.scored-issues li {
		display: grid;
		grid-template-columns: 2rem 3.5rem 1fr;
		grid-template-rows: auto auto;
		gap: 0 8px;
		padding: 6px 8px;
		border-radius: 4px;
		font-size: 0.8rem;
		line-height: 1.5;
	}
	.scored-issues li.selected {
		background: #e8f5e9;
	}
	.scored-issues li.rejected {
		background: #fafafa;
		opacity: 0.6;
	}
	.score {
		grid-row: 1 / 3;
		align-self: center;
		font-size: 1.1rem;
		font-weight: 700;
		text-align: center;
	}
	.selected .score {
		color: #2e7d32;
	}
	.rejected .score {
		color: #9e9e9e;
	}
	.issue-source {
		font-size: 0.7rem;
		color: #757575;
		align-self: end;
	}
	.issue-text {
		font-weight: 600;
		color: #212121;
	}
	.reason {
		grid-column: 3;
		font-size: 0.75rem;
		color: #616161;
	}
</style>
