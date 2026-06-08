<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth.svelte.js';

	let { children } = $props();

	onMount(() => {
		const interval = setInterval(() => {
			if (!authStore.loading && !authStore.user) {
				clearInterval(interval);
				goto('/admin/login');
			}
		}, 50);

		return () => clearInterval(interval);
	});
</script>

{#if authStore.loading}
	<div class="loading">認証確認中...</div>
{:else if authStore.user || $page.url.pathname === '/admin/login'}
	{@render children()}
{/if}
