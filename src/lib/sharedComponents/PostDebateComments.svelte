<script lang="ts">
	import type { PublishedComment } from '$lib/models/session/session.types';

	interface Props {
		comments: PublishedComment[];
	}

	let { comments }: Props = $props();
</script>

<section class="post-debate">
	<h2>討論を終えて</h2>
	<ul class="comment-list">
		{#each comments as comment (comment.personaId)}
			<li class="comment-card">
				<div class="persona">
					<span class="persona-name">{comment.personaName}</span>
					<span class="persona-role">{comment.personaRole}</span>
				</div>
				<p class="content">{comment.content}</p>
			</li>
		{/each}
	</ul>
</section>

<style>
	.post-debate {
		margin-top: 40px;
		padding-top: 24px;
		border-top: 2px solid #e0e0e0;
	}
	h2 {
		font-size: 1.125rem;
		font-weight: 700;
		margin: 0 0 16px;
	}
	.comment-list {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.comment-card {
		padding: 12px 16px;
		background: #f9f9f9;
		border-radius: 8px;
		border-left: 3px solid #bdbdbd;
	}
	.persona {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;
	}
	.persona-name {
		font-weight: 600;
		font-size: 0.875rem;
	}
	.persona-role {
		font-size: 0.75rem;
		color: #757575;
		padding: 1px 6px;
		background: #e0e0e0;
		border-radius: 4px;
	}
	.content {
		margin: 0;
		line-height: 1.6;
		font-size: 0.9rem;
	}
</style>
