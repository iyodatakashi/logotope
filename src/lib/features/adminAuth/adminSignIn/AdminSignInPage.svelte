<script lang="ts">
	import AdminAuthTemplate from '#lib/features/adminAuth/AdminAuthTemplate.svelte';
	import { SignIn } from '@14ch/svelte-firebase-auth';
	import { getAdminAuthStore } from '#lib/stores/adminAuth.ts';

	const store = getAdminAuthStore();
</script>

<svelte:head>
	<title>サインイン — logotope</title>
</svelte:head>

<AdminAuthTemplate>
	<SignIn {store} />
</AdminAuthTemplate>
