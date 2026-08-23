<script lang="ts">
	import { SignIn } from '@14ch/svelte-firebase-auth';
	import { getAdminAuthStore } from '$lib/stores/adminAuth.svelte';

	const store = getAdminAuthStore();
</script>

<div class="admin-sign-in-page">
	<h1 class="admin-sign-in-page__title">logotope</h1>
	<SignIn {store} />
</div>
