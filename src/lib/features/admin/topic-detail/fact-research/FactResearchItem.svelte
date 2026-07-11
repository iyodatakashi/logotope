<script lang="ts">
	import { IconButton, Textarea, ConfirmDialog } from '@14ch/svelte-ui';
	import type { FactItem } from '$lib/models/factBase/factBase.types';
	import type { SvelteComponent } from 'svelte';

	let {
		fact = $bindable(),
		onchange,
		onRemove
	}: {
		fact: FactItem;
		onchange: () => void;
		onRemove: () => void;
	} = $props();

	let confirmDialogRef: SvelteComponent | undefined = $state();
</script>

<li class="fact-research-item__item">
	<div class="fact-research-item__statement">
		<Textarea
			bind:value={fact.statement}
			inline
			minHeight={0}
			fullWidth
			focusStyle="background"
			{onchange}
		/>
	</div>
	<div class="fact-research-item__sources">
		{#each fact.sources as source, sourceIndex (sourceIndex)}
			<div class="fact-research-item__source">
				<a
					class="fact-research-item__source-link"
					href={source.url}
					target="_blank"
					rel="noopener noreferrer">{source.url}</a
				>
			</div>
		{/each}
	</div>
	<IconButton
		type="button"
		ariaLabel="この事実を削除"
		variant="ghost"
		iconFilled
		fontSize={18}
		onclick={() => {
			confirmDialogRef?.open();
		}}
	>
		cancel
	</IconButton>

	<ConfirmDialog
		bind:this={confirmDialogRef}
		title="事実を削除"
		description={`以下の事実を削除します。よろしいですか？

${fact.statement}`}
		submitLabel="削除"
		cancelLabel="キャンセル"
		onSubmit={onRemove}
	/>
</li>

<style>
	.fact-research-item__item {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-rows: auto auto;
		grid-gap: 8px;
		padding: 16px;
		background-color: var(--white);
		border: 1px solid var(--svelte-ui-border-weak-color);
		border-radius: 4px;
	}

	.fact-research-item__statement {
		font-size: var(--svelte-ui-font-size-lg);
		font-weight: bold;
	}

	.fact-research-item__sources {
		grid-column: 1 / 3;
		grid-row: 2 / 3;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.fact-research-item__source {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.fact-research-item__source-link {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--svelte-ui-font-size-sm);
		color: var(--svelte-ui-text-subtle-color);
	}
</style>
