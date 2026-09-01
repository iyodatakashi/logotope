<script lang="ts">
	import AdminAuthTemplate from './AdminAuthTemplate.svelte';
	import { SignUp } from '@14ch/svelte-firebase-auth';
	import { getAdminAuthStore } from '$lib/stores/adminAuth.svelte';

	const store = getAdminAuthStore();
</script>

<AdminAuthTemplate>
	<SignUp {store} />
</AdminAuthTemplate>
