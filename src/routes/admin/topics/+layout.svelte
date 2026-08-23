<script lang="ts">
	import type { Snippet } from 'svelte';
	import AdminDataScope from '$lib/features/admin/AdminDataScope.svelte';

	let { children }: { children: Snippet } = $props();
</script>

<AdminDataScope>
	{@render children()}
</AdminDataScope>
