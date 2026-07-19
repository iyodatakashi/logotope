<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { Button } from '@14ch/svelte-ui';

	let { children }: { children: Snippet } = $props();

	const isLoginPage = $derived(page.url.pathname === '/admin/login');
</script>

<div class="admin-template">
	<div class="admin-template__header">
		<a href="/admin/topics" class="admin-template__logo">logotope</a>
		{#if authStore.isLoggedIn}
			<Button variant="ghost" onclick={() => authStore.logout()}>ログアウト</Button>
		{/if}
	</div>

	{#if authStore.user || isLoginPage}
		{@render children()}
	{/if}
</div>

<style>
	.admin-template {
		display: grid;
		grid-template-rows: auto 1fr;
		height: 100vh;
	}

	.admin-template__header {
		display: flex;
		justify-content: space-between;
		padding: 8px 24px;
		background-color: var(--white);
	}

	.admin-template__logo {
		font-size: 1.2rem;
		font-weight: bold;
		color: var(--svelte-ui-text-color);
	}
</style>
