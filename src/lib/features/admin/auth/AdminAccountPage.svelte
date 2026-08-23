<script lang="ts">
	import { PasswordChange } from '@14ch/svelte-firebase-auth';
	import { getAdminAuthStore } from '$lib/stores/adminAuth.svelte';

	const store = getAdminAuthStore();
</script>

<div class="admin-account-page">
	<h1 class="admin-account-page__title">logotope</h1>
	<PasswordChange {store} />
</div>
