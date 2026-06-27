<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { topicsStore } from '$lib/stores/topics.svelte';
	import { Button } from '@14ch/svelte-ui';

	let { children }: { children: Snippet } = $props();

	const isLoginPage = $derived(page.url.pathname === '/admin/login');

	$effect(() => {
		if (authStore.user) {
			topicsStore.start();
			return () => topicsStore.stop();
		}
	});

	// 認証ストアの状態変化に反応するガード。未認証なら現在のパスを保持してログインへ誘導する
	$effect(() => {
		if (!authStore.loading && !authStore.user && !isLoginPage) {
			goto(`/admin/login?redirect=${encodeURIComponent(page.url.pathname)}`);
		}
	});
</script>

<div class="admin-layout">
	<div class="admin-layout__header">
		<a href="/admin/topics" class="admin-layout__logo">logotope</a>
		{#if authStore.isLoggedIn}
			<Button variant="ghost" onclick={() => authStore.logout()}>ログアウト</Button>
		{/if}
	</div>

	{#if authStore.user || isLoginPage}
		{@render children()}
	{/if}
</div>

<style>
	.admin-layout {
		display: grid;
		grid-template-rows: auto 1fr;
	}

	.admin-layout__header {
		display: flex;
		justify-content: space-between;
		padding: 8px 24px;
		background-color: var(--white);
	}

	.admin-layout__logo {
		font-size: 1.2rem;
		font-weight: bold;
		color: var(--svelte-ui-text-color);
	}
</style>
