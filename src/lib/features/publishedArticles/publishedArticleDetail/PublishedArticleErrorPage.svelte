<script lang="ts">
	import { page } from '$app/state';

	// 記事本文前提のメタ情報は出さず、不在(404)と取得失敗(500)を出し分けてインデックスへ戻す（Req 7.2, 7.3, 8.2, 9.1）。
	const notFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{notFound ? '記事が見つかりません' : '取得に失敗しました'} — logotope</title>
</svelte:head>

<main class="published-article-error-page">
	{#if notFound}
		<h1 class="published-article-error-page__title">記事が見つかりません</h1>
		<p class="published-article-error-page__message">
			お探しの記事は存在しないか、まだ公開されていません。
		</p>
	{:else}
		<h1 class="published-article-error-page__title">取得に失敗しました</h1>
		<p class="published-article-error-page__message">時間をおいて再度お試しください。</p>
	{/if}
	<a class="published-article-error-page__home-link" href="/">記事一覧へ戻る</a>
</main>

<style>
	.published-article-error-page {
		max-width: 720px;
		margin: 0 auto;
		padding: 64px 16px;
		text-align: center;
	}
	.published-article-error-page__title {
		margin: 0 0 12px;
		font-size: 1.5rem;
	}
	.published-article-error-page__message {
		margin: 0 0 24px;
	}
	.published-article-error-page__home-link {
		text-decoration: none;
	}
	.published-article-error-page__home-link:hover {
		text-decoration: underline;
	}
</style>
