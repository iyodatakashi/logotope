<script lang="ts">
	import type { PublishedTurn } from '$lib/types/index.js';

	interface Props {
		turn: PublishedTurn;
	}

	let { turn }: Props = $props();
</script>

<div id="turn-{turn.turnIndex}" class="turn turn-{turn.speakerType}">
	<div class="speaker">
		<span class="speaker-name">{turn.speakerName}</span>
		{#if turn.speakerRole}
			<span class="speaker-role">{turn.speakerRole}</span>
		{/if}
	</div>
	<p class="content">{turn.content}</p>
	{#if turn.beliefChangesTriggered.length > 0}
		<div class="belief-changes">
			{#each turn.beliefChangesTriggered as bc}
				<span data-testid="belief-change-marker" class="belief-marker belief-{bc.changeType}">
					{bc.personaName}
					{bc.changeType === 'opinion_change' ? '意見変化' : '部分承認'}
				</span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.turn {
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 12px;
	}
	.turn-persona {
		background: #fafafa;
		border-left: 3px solid #90caf9;
	}
	.turn-facilitator {
		background: #f3e5f5;
		border-left: 3px solid #ce93d8;
		font-style: italic;
	}
	.speaker {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;
	}
	.speaker-name {
		font-weight: 600;
		font-size: 0.875rem;
	}
	.speaker-role {
		font-size: 0.75rem;
		color: #757575;
		padding: 1px 6px;
		background: #e0e0e0;
		border-radius: 4px;
	}
	.content {
		margin: 0;
		line-height: 1.6;
		white-space: pre-wrap;
	}
	.belief-changes {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}
	.belief-marker {
		font-size: 0.75rem;
		padding: 2px 8px;
		border-radius: 4px;
		font-style: normal;
	}
	.belief-opinion_change {
		background: #ffe0b2;
		color: #e65100;
	}
	.belief-partial_acceptance {
		background: #e8f5e9;
		color: #2e7d32;
	}
</style>
