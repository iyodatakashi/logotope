<script lang="ts">
	import { Button } from '@14ch/svelte-ui';
	import EditingTurnItem from './EditingTurnItem.svelte';
	import type { EditedChapterDisplayStatus } from '$lib/models/chapter/chapter.types';
	import type { Turn, TurnForEditing } from '$lib/models/turn/turn.types';

	interface Props {
		title: string;
		status: EditedChapterDisplayStatus; // completed / failed / missing（章ステータスは本 spec 対象外の別ルール）
		failureReason: string | null;
		showRegenerate: boolean; // isEditingFinished かつ再生成可能なときだけ出す
		turns: TurnForEditing[];
		sourceTurns: Turn[]; // この章の原本ターン。差分の由来テキスト参照に使う
		showDiff: boolean;
		onRegenerate: () => void | Promise<void>;
		editable?: boolean; // 公開中は再生成を凍結する
	}
	let {
		title,
		status,
		failureReason,
		showRegenerate,
		turns,
		sourceTurns,
		showDiff,
		onRegenerate,
		editable = true
	}: Props = $props();

	const statusLabel = (s: EditedChapterDisplayStatus): string =>
		s === 'completed' ? '編集済み' : s === 'failed' ? '原本表示（失敗）' : '未編集';

	// 差分の由来原本テキスト参照。各ターンの描画は EditingTurnItem に委ね、章はこの参照表だけ渡す。
	const contentById = $derived(new Map(sourceTurns.map((turn) => [turn.id, turn.content])));

	// クリック→サーバ書き込みまでの楽観ローディング（二重実行防止）。導入・締め・所感と同じ自持ち方式。
	let regenerating = $state(false);
	const handleRegenerate = async () => {
		if (regenerating) return;
		regenerating = true;
		try {
			await onRegenerate();
		} finally {
			regenerating = false;
		}
	};
</script>

<section class="editing-chapter">
	<header class="editing-chapter__header">
		<div class="editing-chapter__title">{title}</div>
		<span class="editing-chapter__status" data-status={status}>
			{statusLabel(status)}
		</span>
		{#if failureReason}
			<span class="editing-chapter__failure-reason">検証不合格: {failureReason}</span>
		{/if}
		{#if showRegenerate}
			<Button
				variant="outlined"
				onclick={handleRegenerate}
				loading={regenerating}
				disabled={!editable}>再生成</Button
			>
		{/if}
	</header>
	<div class="editing-chapter__turns">
		{#each turns as turn (turn.id)}
			<EditingTurnItem {turn} {status} {showDiff} {contentById} />
		{/each}
	</div>
</section>

<style>
	.editing-chapter__header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}
	.editing-chapter__title {
		font-size: 1.5rem;
		font-weight: bold;
	}
	.editing-chapter__status {
		font-size: var(--svelte-ui-font-size-sm);
		padding: 1px 6px;
		border-radius: 3px;
		background: #eee;
		color: #757575;
	}
	.editing-chapter__status[data-status='completed'] {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.editing-chapter__status[data-status='failed'] {
		background: #ffebee;
		color: #c62828;
	}
	.editing-chapter__failure-reason {
		font-size: var(--svelte-ui-font-size-sm);
		color: #c62828;
	}
	.editing-chapter__turns {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
</style>
