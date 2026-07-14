<script lang="ts">
	import type { Stakeholder } from '$lib/models/stakeholder/stakeholder.types';
	import { engagementStyle } from '$lib/models/engagement/engagement.constants';
	import { Checkbox } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';

	let { stakeholder }: { stakeholder: Stakeholder } = $props();

	const toggle = (selected: boolean) =>
		currentTopicStore.stakeholdersStore.setSelected(stakeholder.id, selected);
</script>

<div class="stakeholder-item">
	<div class="stakeholder-item__check">
		<Checkbox
			value={stakeholder.selected}
			onchange={toggle}
			ariaLabel="このステークホルダーを採用する"
		/>
	</div>
	<div class="stakeholder-item__header">
		<div class="stakeholder-item__role">{stakeholder.role}</div>
		<span
			class="stakeholder-item__engagement"
			style:color={engagementStyle(stakeholder.engagementLevel).color}
			style:background={engagementStyle(stakeholder.engagementLevel).bg}
		>
			{engagementStyle(stakeholder.engagementLevel).label}
		</span>
		<span class="stakeholder-item__minor">マイノリティ度: {stakeholder.minorityLevel}</span>
	</div>
	<p class="stakeholder-item__rationale">{stakeholder.reason}</p>
</div>

<style>
	.stakeholder-item {
		height: 100%;
		padding: 16px;
		background-color: var(--white);
		border-radius: 4px;
	}
	.stakeholder-item__header {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.stakeholder-item__role {
		font-size: var(--svelte-ui-font-size-lg);
		font-weight: bold;
	}

	.stakeholder-item__engagement {
		padding: 2px 8px;
		border-radius: 999px;
		font-size: var(--svelte-ui-font-size-sm);
	}
	.stakeholder-item__minor {
		color: var(--svelte-ui-text-subtle-color);
		font-size: var(--svelte-ui-font-size-sm);
	}
	.stakeholder-item__rationale {
		color: #555;
		margin-top: 6px;
		font-size: var(--svelte-ui-font-size-sm);
	}
</style>
