<script lang="ts">
	import { Button, ConfirmDialog } from '@14ch/svelte-ui';
	import { snackbar } from '@14ch/svelte-ui';
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
		try {
			await onReset();
			await goto(phasePath(topicId, phase));
		} catch (e) {
			snackbar.error(e instanceof Error ? e.message : 'リセットに失敗しました');
		} finally {
			resetting = false;
		}
	};
</script>

<Button
	variant="outlined"
	color="var(--svelte-ui-text-color)"
	disabled={resetting}
	onclick={() => dialog?.open()}>やり直す</Button
>

<ConfirmDialog
	bind:this={dialog}
	title="このフェーズからやり直しますか？"
	{description}
	danger
	submitLabel="やり直す"
	cancelLabel="キャンセル"
	onSubmit={() => void handleSubmit()}
/>
