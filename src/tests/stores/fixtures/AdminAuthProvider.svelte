<script lang="ts">
	import { untrack } from 'svelte';
	import type { AuthStore } from '@14ch/svelte-firebase-auth';
	import { setAdminAuthStore } from '$lib/stores/adminAuth.svelte';
	import AdminAuthConsumer from './AdminAuthConsumer.svelte';

	let { store, onresolve }: { store: AuthStore; onresolve: (store: unknown) => void } = $props();

	setAdminAuthStore(untrack(() => store));
</script>

<AdminAuthConsumer {onresolve} />
