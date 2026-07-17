<script lang="ts">
	import { Switch } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';

	// 公開フェーズの画面。公開 ON/OFF スイッチのみの最小構成。
	// 表示の真実は永続値 topic.published（onSnapshot 由来）で、楽観状態は持たない。
	// 操作中は多重操作を抑止し、失敗時はエラーメッセージのみ表示する（表示は永続値へ自動で戻る）。
	let isSubmitting = $state(false);
	let error = $state<string | null>(null);

	const toggle = async (next: boolean) => {
		const topic = currentTopicStore.topic;
		if (!topic || isSubmitting) return;
		isSubmitting = true;
		error = null;
		try {
			if (next) {
				await topic.publishDebate();
			} else {
				await topic.unpublishDebate();
			}
		} catch {
			error = '公開状態の更新に失敗しました。時間をおいて再度お試しください。';
		} finally {
			isSubmitting = false;
		}
	};
</script>

{#if currentTopicStore.topic}
	<div class="publish-page">
		<div class="publish-page__switch-row">
			<Switch
				value={currentTopicStore.topic.published}
				disabled={isSubmitting}
				ariaLabel="公開"
				onchange={toggle}
			/>
			<span class="publish-page__status">
				{currentTopicStore.topic.published ? '公開中' : '非公開'}
			</span>
		</div>
		{#if error}
			<p class="publish-page__error" role="alert">{error}</p>
		{/if}
	</div>
{/if}

<style>
	.publish-page {
		padding: 24px;
	}
	.publish-page__switch-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.publish-page__status {
		font-weight: bold;
	}
	.publish-page__error {
		margin-top: 12px;
		color: var(--svelte-ui-error-color, #c62828);
	}
</style>
