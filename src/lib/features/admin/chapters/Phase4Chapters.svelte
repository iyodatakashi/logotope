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
		currentTopicStore.chaptersStore.chapters.length ? currentTopicStore.chaptersStore.chapters : null
	);
	const chapterIssues = $derived(currentTopicStore.chapterAnalysisStore.data);

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
		{#if chapters?.length}
			<ol class="chapters">
				{#each chapters as chapter}
					<li>
						<strong>{chapter.title}</strong>
						<span class="focus">{chapter.focusQuestion}</span>
						{#if chapter.discussionPoints?.length}
							<ul class="points">
								{#each chapter.discussionPoints as point}
									<li>{point}</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ol>
			{#if chapterIssues}
				<section class="issues">
					<h3>Step 1 で生成した切り口</h3>
					<div class="issues-grid">
						<div class="issues-col">
							<h4>一般的な切り口（ペルソナなし）</h4>
							<ol>
								{#each chapterIssues.general as issue}
									<li>{issue}</li>
								{/each}
							</ol>
						</div>
						<div class="issues-col">
							<h4>ペルソナ固有の切り口</h4>
							<ol>
								{#each chapterIssues.persona as issue}
									<li>{issue}</li>
								{/each}
							</ol>
						</div>
					</div>
				</section>
			{/if}
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
	.focus {
		display: block;
		color: #757575;
		font-size: 0.875rem;
		margin-top: 2px;
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
</style>
