<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getAdminAuthStore } from '$lib/stores/adminAuth.svelte';
	import { Button } from '@14ch/svelte-ui';

	let { children }: { children: Snippet } = $props();

	const store = getAdminAuthStore();
</script>

<div class="admin-template">
	<div class="admin-template__header">
		<a href="/admin/topics" class="admin-template__logo">logotope</a>
		{#if store.isLoggedIn}
			<div class="admin-template__account">
				<a href="/admin/account" class="admin-template__account-link">パスワードの変更</a>
				<Button variant="ghost" onclick={() => store.signOut()}>ログアウト</Button>
			</div>
		{/if}
	</div>

	{@render children()}
</div>

<style>
	.admin-template {
		display: grid;
		grid-template-rows: auto 1fr;
		height: 100vh;
	}

	.admin-template__header {
		display: flex;
		justify-content: space-between;
		padding: 8px 24px;
		background-color: var(--white);
	}

	.admin-template__logo {
		font-size: 1.2rem;
		font-weight: bold;
		color: var(--svelte-ui-text-color);
	}
</style>
