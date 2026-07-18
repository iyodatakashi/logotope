<script lang="ts">
	// 導入/締めの共通表示部品。ラベルで使い分ける。内容が無い要素は呼び出し側が描画しない（Req 1.6）。
	interface Props {
		label: string; // 「導入」/「締め」
		content: string;
	}
	let { label, content }: Props = $props();
</script>

<section class="article-narration">
	<h2 class="article-narration__label">{label}</h2>
	<p class="article-narration__body">{content}</p>
</section>

<style>
	.article-narration__label {
		margin: 0 0 8px;
		font-size: var(--svelte-ui-font-size-sm);
		font-weight: 700;
		color: #7b1fa2;
	}
	.article-narration__body {
		margin: 0;
		line-height: 1.8;
		white-space: pre-wrap;
	}
</style>
