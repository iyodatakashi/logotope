<script lang="ts">
	import type { Stakeholder } from '$lib/models/stakeholder/stakeholder.types';
	import { engagementStyle } from '$lib/models/engagement/engagement.constants';

	// ステークホルダーは採用操作を持たない中間生成物。どの立場からペルソナを起こしたかの確認材料として表示のみ。
	let { stakeholder }: { stakeholder: Stakeholder } = $props();
</script>

<div class="stakeholder-item">
	<div class="stakeholder-item__header">
		<span class="stakeholder-item__role">{stakeholder.role}</span>
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
		display: block;
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
		font-size: var(--svelte-ui-font-size-sm);
	}
</style>
