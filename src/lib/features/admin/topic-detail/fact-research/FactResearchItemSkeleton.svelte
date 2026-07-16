<script lang="ts">
	import { Skeleton, SkeletonText } from '@14ch/svelte-ui';
</script>

<li class="fact-research-item__item">
	<div class="fact-research-item__statement">
		<SkeletonText width="80%" />
	</div>
	<div class="fact-research-item__sources">
		<Skeleton
			patterns={[
				{ type: 'text', width: '60%' },
				{ type: 'text', width: '70%' },
				{ type: 'text', width: '50%' }
			]}
			patternGap="4px"
		/>
	</div>
</li>

<style>
	.fact-research-item__item {
		display: grid;
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
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: var(--svelte-ui-font-size-sm);
	}
</style>
