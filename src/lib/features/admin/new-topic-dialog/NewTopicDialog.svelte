<script lang="ts">
	import { Button, Input, Dialog, snackbarManager } from '@14ch/svelte-ui';
	import type { SvelteComponent } from 'svelte';
	import { topicsStore } from '$lib/stores/topics.svelte';
	import { goto } from '$app/navigation';
	import { TITLE_MAX_LENGTH } from '$lib/models/topic/topic.constants';

	let dialogRef: SvelteComponent | undefined = $state();
	let title = $state('');
	let isLoading = $state(false);

	const handleSubmit = async () => {
		isLoading = true;
		try {
			const topicId = await topicsStore.addTopic(title);

			goto(`/admin/topics/${topicId}`);
		} catch {
			snackbarManager.error('テーマの作成に失敗しました。再試行してください。');
		} finally {
			isLoading = false;
		}
	};

	export const open = () => {
		dialogRef?.open();
	};

	const isValid = $derived.by(() => {
		if (!title.trim()) {
			return false;
		}
		if (title.length > TITLE_MAX_LENGTH) {
			return false;
		}
		return true;
	});

	const errorMessage = $derived.by(() => {
		if (title.length > TITLE_MAX_LENGTH) {
			return `${TITLE_MAX_LENGTH}文字以内で入力してください`;
		}
		return null;
	});
</script>

<Dialog bind:this={dialogRef} title="新しいテーマを作成" width="600px">
	<div class="new-topic-dialog__body">
		<Input
			id="topic-title"
			value={title}
			oninput={(value) => (title = String(value))}
			placeholder="討論テーマのタイトルを入力してください（{TITLE_MAX_LENGTH}文字以内）"
			fullWidth
		/>
		{#if errorMessage}
			<p role="alert" class="new-topic-dialog__error-message">{errorMessage}</p>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" loading={isLoading} onclick={() => dialogRef?.close()}>
			キャンセル
		</Button>
		<Button variant="filled" loading={isLoading} disabled={!isValid} onclick={handleSubmit}>
			テーマを作成
		</Button>
	{/snippet}
</Dialog>

<style>
	.new-topic-dialog__body {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.new-topic-dialog__error-message {
		color: var(--text-error);
	}
</style>
