<script lang="ts">
	import { Button, ConfirmDialog } from '@14ch/svelte-ui';
	import { goto } from '$app/navigation';
	import { phasePath } from '$lib/utils/phase.js';

	interface Props {
		phase: 1 | 2 | 3;
		topicId: string;
		discardSummary: string[];
		onReset: () => Promise<void>;
	}
	let { phase, topicId, discardSummary, onReset }: Props = $props();

	let dialog: ReturnType<typeof ConfirmDialog> | undefined = $state();
	let resetting = $state(false);
	let error = $state('');

	const description = $derived(
		[
			'以下のデータが破棄されます。この操作は取り消せません。',
			'',
			...discardSummary.map((item) => `・${item}`)
		].join('\n')
	);

	const handleSubmit = async () => {
		if (resetting) return;
		resetting = true;
		error = '';
		try {
			await onReset();
			await goto(phasePath(topicId, phase));
		} catch (e) {
			error = e instanceof Error ? e.message : 'リセットに失敗しました';
		} finally {
			resetting = false;
		}
	};
</script>

<div class="reset-panel">
	<p class="note">このフェーズの内容を修正するには、ここからやり直します。</p>
	<Button disabled={resetting} onclick={() => dialog?.open()}>このフェーズからやり直す</Button>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
</div>

<ConfirmDialog
	bind:this={dialog}
	title="このフェーズからやり直しますか？"
	{description}
	danger
	submitLabel="やり直す"
	cancelLabel="キャンセル"
	onSubmit={() => void handleSubmit()}
/>

<style>
	.reset-panel { margin-top: 24px; padding: 16px; border: 1px solid #e0e0e0; border-radius: 8px; }
	.note { color: #555; font-size: 0.875rem; margin: 0 0 12px; }
	.error { color: #c62828; font-size: 0.875rem; margin: 12px 0 0; }
</style>
