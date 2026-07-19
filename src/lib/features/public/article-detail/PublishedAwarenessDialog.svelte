<script lang="ts">
	import { Dialog } from '@14ch/svelte-ui';
	import type { PublishedAwareness } from '$lib/models/published/published-article.types';

	// 気づき一覧を表示する独立コンポーネント。ダイアログは自身の状態を持つ svelte-ui Dialog に委ね、
	// 親からは open() で開く（InterviewDialog と同じ命令的パターン）。閉じるは Dialog 標準操作で本文へ戻れる。
	interface Props {
		awarenesses: PublishedAwareness[];
	}
	let { awarenesses }: Props = $props();

	let dialogRef: ReturnType<typeof Dialog> | undefined = $state();
	export const open = (): void => dialogRef?.open();
</script>

<Dialog bind:this={dialogRef} title="気づき" scrollable width="480px">
	<ul class="published-awareness-dialog__list">
		{#each awarenesses as awareness, i (i)}
			<li class="published-awareness-dialog__item">
				<span class="published-awareness-dialog__persona">{awareness.personaName}</span>: {awareness.content}
			</li>
		{/each}
	</ul>
</Dialog>

<style>
	.published-awareness-dialog__list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
	}
	.published-awareness-dialog__persona {
		font-weight: bold;
	}
</style>
