<script lang="ts">
	import type { Snippet } from 'svelte';
	import { topicsStore } from '$lib/stores/topics.svelte';

	let { children }: { children: Snippet } = $props();

	// 到達の制御の内側、かつトピックを要する階層にのみ置く。開始も停止も条件を持たない
	$effect(() => {
		topicsStore.start();
		return () => topicsStore.stop();
	});
</script>

{@render children()}
