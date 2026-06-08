<script lang="ts">
	import { Button } from '@14ch/svelte-ui';

	interface Props {
		onSubmit: (title: string) => void;
		loading?: boolean;
	}

	let { onSubmit, loading = false }: Props = $props();

	let title = $state('');
	let error = $state('');

	function validate(): boolean {
		if (!title.trim()) {
			error = 'テーマを入力してください';
			return false;
		}
		if (title.length > 500) {
			error = '500文字以内で入力してください';
			return false;
		}
		error = '';
		return true;
	}

	function handleSubmit() {
		if (validate()) {
			onSubmit(title.trim());
		}
	}
</script>

<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
	<div class="field">
		<label for="topic-title">討論テーマ</label>
		<textarea
			id="topic-title"
			bind:value={title}
			placeholder="討論したいテーマを入力してください（500文字以内）"
			rows={4}
			aria-label="討論テーマ"
		></textarea>
		{#if error}
			<p role="alert" class="error">{error}</p>
		{/if}
	</div>
	<Button type="submit" variant="filled" fullWidth {loading}>テーマを作成</Button>
</form>

<style>
	.field {
		margin-bottom: 16px;
	}
	textarea {
		width: 100%;
		padding: 8px 12px;
		border: 1px solid #ccc;
		border-radius: 4px;
		font-size: 1rem;
		resize: vertical;
	}
	.error {
		color: #d32f2f;
		margin-top: 4px;
		font-size: 0.875rem;
	}
</style>
