<script lang="ts">
	import { SignUp } from '@14ch/svelte-firebase-auth';
	import { getAdminAuthStore } from '$lib/stores/adminAuth.svelte';

	const store = getAdminAuthStore();
</script>

<div class="admin-sign-up-page">
	<h1 class="admin-sign-up-page__title">logotope</h1>
	<SignUp {store} />
</div>
