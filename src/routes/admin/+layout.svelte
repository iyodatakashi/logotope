<script lang="ts">
	import type { Snippet } from 'svelte';
	import { AuthGate, AuthSession, createAuthStore } from '@14ch/svelte-firebase-auth';
	import { auth } from '#lib/stores/firebase.ts';
	import { ADMIN_AUTH_CONFIG } from '#lib/models/adminAuth/adminAuth.constants.ts';
	import { setAdminAuthStore } from '#lib/stores/adminAuth.ts';

	let { children }: { children: Snippet } = $props();

	const store = createAuthStore(auth, ADMIN_AUTH_CONFIG);
	setAdminAuthStore(store);
</script>

{#snippet pending()}
	<p class="admin-layout__pending">読み込み中</p>
{/snippet}

<AuthSession {store} namespace="logotope-admin" />

<AuthGate {store} {pending}>
	{@render children()}
</AuthGate>
