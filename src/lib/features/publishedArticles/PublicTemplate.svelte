<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="public-template">
	<div class="public-template__header">
		<a href="/" class="public-template__logo">logotope</a>
	</div>
	<div class="public-template__content">
		{@render children()}
	</div>
</div>

<style>
	.public-template {
		display: grid;
		grid-template-rows: auto 1fr;
		height: 100vh;
	}

	.public-template__header {
		display: flex;
		justify-content: space-between;
		padding: 8px 24px;
		background-color: var(--white);
	}

	.public-template__logo {
		font-size: 1.2rem;
		font-weight: bold;
		color: var(--svelte-ui-text-color);
	}

	.public-template__content {
		overflow-y: auto;
	}
</style>
