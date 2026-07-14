<script lang="ts">
	import type { Persona, DraftBelief } from '$lib/models/persona/persona.types';
	import type { SvelteComponent } from 'svelte';
	import InterviewDialog from './InterviewDialog.svelte';
	import InterviewItem from './InterviewItem.svelte';

	let { persona }: { persona: Persona } = $props();
	let interviewDialogRef: SvelteComponent | undefined = $state();

	const interview = $derived(persona.interview);
</script>

<div class="persona-item">
	<button class="persona-item__button" onclick={() => interviewDialogRef?.open()}>
		<div class="persona-item__header">
			<span class="persona-item__name">{persona.name}</span>
			<span class="persona-item__age">{persona.age}歳</span>
			<span
				class="persona-item__status-badge"
				class:persona-item__status-badge--done={interview?.status === 'completed'}
				class:persona-item__status-badge--active={interview?.status === 'in_progress'}
				class:persona-item__status-badge--err={interview?.status === 'error'}
			>
				{#if interview?.status === 'completed'}完了
				{:else if interview?.status === 'in_progress'}取材中
				{:else if interview?.status === 'error'}エラー
				{:else}待機中{/if}
			</span>
		</div>

		<div class="persona-item__meta">
			<div class="persona-item__badge">{persona.specificRole ?? persona.stakeholderRole}</div>
			<!--
		{#if persona.occupation && persona.occupation !== (persona.specificRole ?? persona.stakeholderRole)}
			<div class="persona-item__occupation">{persona.occupation}</div>
		{/if}
	-->
		</div>

		<div class="persona-item__bg">{persona.background}</div>
	</button>

	<InterviewDialog bind:this={interviewDialogRef} {persona} />
</div>

<style>
	.persona-item {
		height: 100%;
	}

	.persona-item__button {
		display: flex;
		flex-direction: column;
		gap: 8px;
		height: 100%;
		padding: 16px;
		background-color: var(--white);
		border-radius: 4px;
		text-align: left;
		color: var(--svelte-ui-text-color);
	}

	.persona-item__header {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: baseline;
		gap: 8px;

		.persona-item__name {
			font-size: var(--svelte-ui-font-size-lg);
			font-weight: bold;
		}
	}

	.persona-item__meta {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.persona-item__bg {
		font-size: var(--svelte-ui-font-size-sm);
	}
	.persona-item__status-badge {
		padding: 2px 8px;
		background: #e3f2fd;
		color: #1565c0;
		border-radius: 12px;
		font-size: var(--svelte-ui-font-size-sm);
		flex-shrink: 0;
	}
	.persona-item__status-badge.persona-item__status-badge--done {
		background: #c8e6c9;
		color: #2e7d32;
	}
	.persona-item__status-badge.persona-item__status-badge--active {
		background: #bbdefb;
		color: #1565c0;
		font-weight: 600;
	}
	.persona-item__status-badge.persona-item__status-badge--err {
		background: #ffcdd2;
		color: #c62828;
	}
</style>
