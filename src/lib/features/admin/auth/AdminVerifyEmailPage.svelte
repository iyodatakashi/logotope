<script lang="ts">
	import { VerifyEmail } from '@14ch/svelte-firebase-auth';
	import { getAdminAuthStore } from '$lib/stores/adminAuth.svelte';

	const store = getAdminAuthStore();
</script>

<div class="admin-verify-email-page">
	<h1 class="admin-verify-email-page__title">logotope</h1>
	<VerifyEmail {store} />
</div>
