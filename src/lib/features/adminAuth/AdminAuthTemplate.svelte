<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="admin-auth-template">
	<h1>logotope</h1>
	{@render children()}
</div>

<style>
	.admin-auth-template {
		width: 480px;
		margin: 0 auto;
	}
</style>
