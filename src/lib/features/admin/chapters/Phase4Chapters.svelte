<script lang="ts">
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { createPhaseController } from '$lib/models/topic/phaseController.svelte.js';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';

	const controller = createPhaseController(4);
	const chapters = $derived(currentTopicStore.sessionStore.session?.chapters ?? null);
	const chapterIssues = $derived(currentTopicStore.sessionStore.session?.chapterIssues ?? null);
</script>

<PhasePanel
	{controller}
	title="フェーズ 4: 章立て"
	generateHint="取材結果をもとに討論の章立てを生成します。"
>
	{#snippet content()}
		{#if chapters?.length}
			<ol class="chapters">
				{#each chapters as chapter}
					<li>
						<strong>{chapter.title}</strong>
						<span class="focus">{chapter.focusQuestion}</span>
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
