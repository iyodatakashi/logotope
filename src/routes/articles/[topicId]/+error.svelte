<script lang="ts">
	import { page } from '$app/state';
	// 記事本文前提のメタ情報は出さず、不在(404)と取得失敗(500)を出し分けてインデックスへ戻す（Req 7.2, 7.3, 8.2, 9.1）。
	const notFound = $derived(page.status === 404);
</script>

<main class="article-error">
	{#if notFound}
		<h1 class="article-error__title">記事が見つかりません</h1>
		<p class="article-error__message">お探しの記事は存在しないか、まだ公開されていません。</p>
	{:else}
		<h1 class="article-error__title">取得に失敗しました</h1>
		<p class="article-error__message">時間をおいて再度お試しください。</p>
	{/if}
	<a class="article-error__home-link" href="/">記事一覧へ戻る</a>
</main>

<style>
	.article-error {
		max-width: 720px;
		margin: 0 auto;
		padding: 64px 16px;
		text-align: center;
	}
	.article-error__title {
		margin: 0 0 12px;
		font-size: 1.5rem;
	}
	.article-error__message {
		margin: 0 0 24px;
	}
	.article-error__home-link {
		text-decoration: none;
	}
	.article-error__home-link:hover {
		text-decoration: underline;
	}
</style>
