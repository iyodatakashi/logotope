<script lang="ts">
	import { Button, Switch } from '@14ch/svelte-ui';
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phasePath } from '$lib/models/phase/phase';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';

	// 公開フェーズの画面。他フェーズと同じ操作ペイン（前に戻る＋中央操作）の構成に揃える。
	// 表示の真実は永続値 topic.published（onSnapshot 由来）で、楽観状態は持たない。
	// 操作中は多重操作を抑止し、失敗時はエラーメッセージのみ表示する（表示は永続値へ自動で戻る）。
	let isSubmitting = $state(false);
	let error = $state<string | null>(null);

	// 前に戻る: 編集画面へ戻るだけ。phase/公開状態は変更しない。
	const handleBackClick = () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		goto(phasePath(topic.id, 'editing'));
	};

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

<PhasePanel>
	{#snippet actions()}
		<div class="publish-page__actions">
			<Button variant="outlined" icon="arrow_back" rounded onclick={handleBackClick}>
				前に戻る
			</Button>
			{#if currentTopicStore.topic}
				<div class="publish-page__center">
					<Switch
						value={currentTopicStore.topic.published}
						disabled={isSubmitting}
						onchange={toggle}
					>
						公開
					</Switch>
				</div>
			{/if}
			<!-- 最終フェーズのため「次に進む」は持たない（中央スロットを中央に保つ空プレースホルダ）。 -->
			<div class="publish-page__spacer"></div>
		</div>
	{/snippet}

	{#snippet content()}
		{#if error}
			<div class="publish-page__content">
				<p class="publish-page__error" role="alert">{error}</p>
			</div>
		{/if}
	{/snippet}
</PhasePanel>

<style>
	.publish-page__actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.publish-page__center {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.publish-page__spacer {
		/* 最終フェーズは右端（次に進む）を持たないが、中央スロットを中央に保つための空プレースホルダ。 */
		width: 0;
	}

	.publish-page__content {
		max-width: 960px;
		margin: 0 auto;
		padding: 24px;
	}

	.publish-page__error {
		color: var(--svelte-ui-error-color);
		font-size: var(--svelte-ui-font-size-sm);
	}
</style>
