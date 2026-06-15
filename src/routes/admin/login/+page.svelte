<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button, Input } from '@14ch/svelte-ui';
	import { authStore } from '$lib/stores/auth.svelte';
	import { sanitizeAdminRedirect } from '$lib/utils/redirect';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	const redirectTo = $derived(sanitizeAdminRedirect(page.url.searchParams.get('redirect')));

	// ログイン成功・認証済みアクセスの両方を認証状態の変化で扱い、検証済みの復帰先へ遷移する
	$effect(() => {
		if (!authStore.loading && authStore.user) {
			goto(redirectTo);
		}
	});

	const handleLogin = async () => {
		error = '';
		loading = true;
		try {
			await authStore.login(email, password);
		} catch {
			error = 'メールアドレスまたはパスワードが正しくありません';
			loading = false;
		}
	};
</script>

<div class="login-container">
	<h1>管理者ログイン</h1>
	<form onsubmit={(e) => { e.preventDefault(); handleLogin(); }}>
		<div class="field">
			<label for="email">メールアドレス</label>
			<Input id="email" type="email" value={email} oninput={(v) => (email = String(v))} fullWidth />
		</div>
		<div class="field">
			<label for="password">パスワード</label>
			<Input id="password" type="password" value={password} oninput={(v) => (password = String(v))} fullWidth />
		</div>
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		<Button type="submit" variant="filled" fullWidth {loading}>ログイン</Button>
	</form>
</div>

<style>
	.login-container {
		max-width: 400px;
		margin: 80px auto;
		padding: 32px;
	}
	.field {
		margin-bottom: 16px;
	}
	.error {
		color: #d32f2f;
		margin-bottom: 12px;
	}
</style>
