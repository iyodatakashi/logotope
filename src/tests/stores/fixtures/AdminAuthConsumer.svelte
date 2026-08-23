<script lang="ts">
	import { untrack } from 'svelte';
	import { getAdminAuthStore } from '$lib/stores/adminAuth.svelte';

	let { onresolve }: { onresolve: (store: unknown) => void } = $props();

	untrack(() => onresolve)(getAdminAuthStore());
</script>
