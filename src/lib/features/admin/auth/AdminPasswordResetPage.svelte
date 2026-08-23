<script lang="ts">
	import { PasswordReset } from '@14ch/svelte-firebase-auth';
	import { getAdminAuthStore } from '$lib/stores/adminAuth.svelte';

	const store = getAdminAuthStore();
</script>

<div class="admin-password-reset-page">
	<h1 class="admin-password-reset-page__title">logotope</h1>
	<PasswordReset {store} />
</div>
