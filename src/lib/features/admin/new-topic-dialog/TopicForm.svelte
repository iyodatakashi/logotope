<script lang="ts">
	import { Button, Input } from '@14ch/svelte-ui';

	// 作成時に受け取るのはタイトルだけ。説明・参考URLはテーマ設定フェーズの画面で入力する。
	interface Props {
		onSubmit: (title: string) => void;
		loading?: boolean;
	}

	let { onSubmit, loading = false }: Props = $props();

	let title = $state('');
	let titleError = $state('');

	const handleSubmit = () => {
		if (!title.trim()) {
			titleError = 'タイトルを入力してください';
			return;
		}
		if (title.length > 500) {
			titleError = '500文字以内で入力してください';
			return;
		}
		titleError = '';
		onSubmit(title.trim());
	};
</script>

<form
	onsubmit={(event) => {
		event.preventDefault();
		handleSubmit();
	}}
>
	<div>
		<label for="topic-title">タイトル</label>
		<Input
			id="topic-title"
			value={title}
			oninput={(value) => (title = String(value))}
			placeholder="討論テーマのタイトルを入力してください（500文字以内）"
			fullWidth
		/>
		{#if titleError}
			<p role="alert">{titleError}</p>
		{/if}
	</div>

	<Button type="submit" variant="filled" fullWidth {loading}>テーマを作成</Button>
</form>
