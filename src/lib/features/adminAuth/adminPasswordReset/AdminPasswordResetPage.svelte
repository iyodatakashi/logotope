<script lang="ts">
	import AdminAuthTemplate from '#lib/features/adminAuth/AdminAuthTemplate.svelte';
	import { PasswordReset } from '@14ch/svelte-firebase-auth';
	import { getAdminAuthStore } from '#lib/stores/adminAuth.ts';

	const store = getAdminAuthStore();
</script>

<svelte:head>
	<title>パスワードの再設定 — logotope</title>
</svelte:head>

<AdminAuthTemplate>
	<PasswordReset {store} />
</AdminAuthTemplate>
