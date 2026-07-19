<script lang="ts">
	import type { Snippet } from 'svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { topicsStore } from '$lib/stores/topics.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

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

{@render children()}
