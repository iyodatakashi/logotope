<script lang="ts">
	import type { Persona } from '$lib/models/persona/persona.types';
	import type { SvelteComponent } from 'svelte';
	import { Checkbox, Button } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import InterviewDialog from './InterviewDialog.svelte';

	let { persona }: { persona: Persona } = $props();
	let interviewDialogRef: SvelteComponent | undefined = $state();

	const interview = $derived(persona.interview);

	// 採用/不採用は安定 id をキーに永続する（フェーズ承認・前進とは独立にいつでも切替可能）。
	const toggleSelected = (selected: boolean) =>
		currentTopicStore.personasStore.setSelected(persona.id, selected);

	// 再取材はこのペルソナ1人だけを取り直す（取材の成否に関わらず常時可能）。
	const reinterview = () => {
		const title = currentTopicStore.topic?.title;
		if (!title) return;
		currentTopicStore.personasStore.reinterview(persona.id, title);
	};
</script>

<div class="persona-item">
	<div class="persona-item__header">
		<div class="persona-item__select">
			<Checkbox
				value={persona.selected}
				onchange={toggleSelected}
				ariaLabel="このペルソナを討論に採用する"
			/>
		</div>
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
			{:else if interview?.status === 'error'}失敗
			{:else}待機中{/if}
		</span>
	</div>

	<button class="persona-item__body" onclick={() => interviewDialogRef?.open()}>
		<div class="persona-item__badge">{persona.specificRole ?? persona.stakeholderRole}</div>
		<div class="persona-item__bg">{persona.background}</div>
	</button>

	<div class="persona-item__footer">
		<Button
			variant="ghost"
			rounded
			icon="cached"
			loading={interview?.status === 'in_progress'}
			onclick={reinterview}
		>
			再取材する
		</Button>
	</div>

	<InterviewDialog bind:this={interviewDialogRef} {persona} />
</div>

<style>
	.persona-item {
		display: flex;
		flex-direction: column;
		gap: 8px;
		height: 100%;
		padding: 16px;
		background-color: var(--white);
		border: solid 1px var(--svelte-ui-border-weak-color);
		border-radius: 4px;
	}

	.persona-item__header {
		display: grid;
		grid-template-columns: auto auto 1fr auto;
		align-items: center;
		gap: 8px;

		.persona-item__name {
			font-size: var(--svelte-ui-font-size-lg);
			font-weight: bold;
		}
	}

	.persona-item__body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		text-align: left;
		color: var(--svelte-ui-text-color);
	}

	.persona-item__bg {
		font-size: var(--svelte-ui-font-size-sm);
	}

	.persona-item__footer {
		display: flex;
		justify-content: flex-end;
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
