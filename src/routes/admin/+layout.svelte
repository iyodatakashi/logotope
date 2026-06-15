<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { topicsStore } from '$lib/stores/topics.svelte';

	let { children }: { children: Snippet } = $props();

	const isLoginPage = $derived(page.url.pathname === '/admin/login');

	onMount(() => {
		topicsStore.start();
		return () => topicsStore.stop();
	});

	// 認証ストアの状態変化に反応するガード。未認証なら現在のパスを保持してログインへ誘導する
	$effect(() => {
		if (!authStore.loading && !authStore.user && !isLoginPage) {
			goto(`/admin/login?redirect=${encodeURIComponent(page.url.pathname)}`);
		}
	});
</script>

{#if authStore.loading}
	<div class="loading">認証確認中...</div>
{:else if authStore.user || isLoginPage}
	{@render children()}
{/if}
