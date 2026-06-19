<script lang="ts">
	import { Button, Input, Textarea } from '@14ch/svelte-ui';

	interface Props {
		onSubmit: (title: string, description: string, sourceUrls: string[]) => void;
		loading?: boolean;
	}

	let { onSubmit, loading = false }: Props = $props();

	let title = $state('');
	let description = $state('');
	let sourceUrls = $state<string[]>([]);
	let titleError = $state('');
	let descriptionError = $state('');
	let urlErrors = $state<string[]>([]);

	function addUrl() {
		if (sourceUrls.length < 5) {
			sourceUrls = [...sourceUrls, ''];
			urlErrors = [...urlErrors, ''];
		}
	}

	function removeUrl(index: number) {
		sourceUrls = sourceUrls.filter((_, i) => i !== index);
		urlErrors = urlErrors.filter((_, i) => i !== index);
	}

	function validate(): boolean {
		let valid = true;

		if (!title.trim()) {
			titleError = 'タイトルを入力してください';
			valid = false;
		} else if (title.length > 500) {
			titleError = '500文字以内で入力してください';
			valid = false;
		} else {
			titleError = '';
		}

		if (description.length > 2000) {
			descriptionError = '2000文字以内で入力してください';
			valid = false;
		} else {
			descriptionError = '';
		}

		const newUrlErrors = sourceUrls.map((url) => {
			if (url && !url.startsWith('https://') && !url.startsWith('http://')) {
				return 'https:// または http:// で始まるURLを入力してください';
			}
			return '';
		});
		urlErrors = newUrlErrors;
		if (newUrlErrors.some((e) => e)) valid = false;

		return valid;
	}

	function handleSubmit() {
		if (validate()) {
			const filteredUrls = sourceUrls.filter((u) => u.trim());
			onSubmit(title.trim(), description, filteredUrls);
		}
	}
</script>

<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
	<div>
		<label for="topic-title">タイトル</label>
		<Input
			id="topic-title"
			value={title}
			oninput={(v) => (title = String(v))}
			placeholder="討論テーマのタイトルを入力してください（500文字以内）"
			fullWidth
		/>
		{#if titleError}
			<p role="alert">{titleError}</p>
		{/if}
	</div>

	<div>
		<label for="topic-description">詳細説明</label>
		<Textarea
			id="topic-description"
			value={description}
			oninput={(v) => (description = v)}
			placeholder="テーマの背景・文脈を入力してください（任意・2000文字以内）"
			rows={4}
			fullWidth
		/>
		{#if descriptionError}
			<p role="alert">{descriptionError}</p>
		{/if}
	</div>

	<div>
		<p>参考URL（任意・最大5件）</p>
		{#each sourceUrls as _url, i}
			<div>
				<Input
					value={sourceUrls[i]}
					oninput={(v) => (sourceUrls[i] = String(v))}
					placeholder="https://"
					fullWidth
				/>
				<Button type="button" variant="text" onclick={() => removeUrl(i)}>削除</Button>
			</div>
			{#if urlErrors[i]}
				<p role="alert">{urlErrors[i]}</p>
			{/if}
		{/each}
		{#if sourceUrls.length < 5}
			<Button type="button" variant="outlined" onclick={addUrl}>URLを追加</Button>
		{/if}
	</div>

	<Button type="submit" variant="filled" fullWidth {loading}>テーマを作成</Button>
</form>
