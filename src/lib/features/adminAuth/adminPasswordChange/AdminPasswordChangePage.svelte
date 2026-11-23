<script lang="ts">
	import AdminAuthTemplate from '#lib/features/adminAuth/AdminAuthTemplate.svelte';
	import { goto } from '$app/navigation';
	import { PasswordChange } from '@14ch/svelte-firebase-auth';
	import { getAdminAuthStore } from '#lib/stores/adminAuth.ts';

	const store = getAdminAuthStore();

	// パスワードの変更は認証の段階を変えないため、到達の制御が利用者を動かさない。
	// 完了後の行き先を決められるのは組み込み側だけ（→ モジュールの onCompleted）
	const returnToAdmin = () => {
		goto(store.routes.afterSignIn);
	};
</script>

<svelte:head>
	<title>パスワードの変更 — logotope</title>
</svelte:head>

<AdminAuthTemplate>
	<PasswordChange {store} onCompleted={returnToAdmin} />
</AdminAuthTemplate>
