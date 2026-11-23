<script lang="ts">
	import AdminAuthTemplate from '#lib/features/adminAuth/AdminAuthTemplate.svelte';
	import { VerifyEmail } from '@14ch/svelte-firebase-auth';
	import { getAdminAuthStore } from '#lib/stores/adminAuth.ts';

	const store = getAdminAuthStore();
</script>

<svelte:head>
	<title>メールアドレスの確認 — logotope</title>
</svelte:head>

<AdminAuthTemplate>
	<VerifyEmail {store} />
</AdminAuthTemplate>
