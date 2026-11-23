<script lang="ts">
	import AdminAuthTemplate from '#lib/features/adminAuth/AdminAuthTemplate.svelte';
	import { SignUp } from '@14ch/svelte-firebase-auth';
	import { getAdminAuthStore } from '#lib/stores/adminAuth.ts';

	const store = getAdminAuthStore();
</script>

<svelte:head>
	<title>アカウントの登録 — logotope</title>
</svelte:head>

<AdminAuthTemplate>
	<SignUp {store} />
</AdminAuthTemplate>
