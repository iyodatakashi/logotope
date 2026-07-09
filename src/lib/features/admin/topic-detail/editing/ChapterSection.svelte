<script lang="ts">
	import { Button } from '@14ch/svelte-ui';
	import DiffText from '$lib/sharedComponents/DiffText.svelte';
	import type {
		EditedChapterDisplayStatus,
		TurnForEditing
	} from '$lib/models/editedChapter/editedChapter.types';

	interface Props {
		title: string;
		status: EditedChapterDisplayStatus; // completed / failed / missing（章ステータスは本 spec 対象外の別ルール）
		failureReason: string | null;
		showRegenerate: boolean; // isEditingFinished かつ再生成可能なときだけ出す
		turns: TurnForEditing[];
		showDiff: boolean;
		onRegenerate: () => void | Promise<void>;
	}
	let { title, status, failureReason, showRegenerate, turns, showDiff, onRegenerate }: Props =
		$props();

	const statusLabel = (s: EditedChapterDisplayStatus): string =>
		s === 'completed' ? '編集済み' : s === 'failed' ? '原本表示（失敗）' : '未編集';

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

<section class="editing-page__chapter">
	<header class="editing-page__chapter-header">
		<div class="editing-page__chapter-title">{title}</div>
		<span class="editing-page__chapter-status" data-status={status}>
			{statusLabel(status)}
		</span>
		{#if failureReason}
			<span class="editing-page__failure-reason">検証不合格: {failureReason}</span>
		{/if}
		{#if showRegenerate}
			<Button variant="outlined" onclick={handleRegenerate} loading={regenerating}>再生成</Button>
		{/if}
	</header>
	<div class="editing-page__turns">
		{#each turns as turn (turn.id)}
			{#if turn.removed}
				{#if showDiff}
					<div
						class="editing-page__turn editing-page__turn--removed"
						class:editing-page__turn--facilitator={turn.name === 'ファシリテーター'}
					>
						<div class="editing-page__speaker">
							<div class="editing-page__speaker-name">{turn.name}</div>
							{#if turn.role}<span class="editing-page__role">({turn.role})</span>{/if}
							<span class="editing-page__removed-label">発言ごと削除</span>
						</div>
						<p class="editing-page__content"><del>{turn.content}</del></p>
					</div>
				{/if}
			{:else}
				<div
					class="editing-page__turn"
					class:editing-page__turn--facilitator={turn.name === 'ファシリテーター'}
				>
					<div class="editing-page__speaker">
						<div class="editing-page__speaker-name">{turn.name}</div>
						{#if turn.role}<span class="editing-page__role">({turn.role})</span>{/if}
						{#if turn.speechMode}
							<span class="editing-page__speech-mode" data-mode={turn.speechMode}
								>{turn.speechMode}</span
							>
						{/if}
					</div>
					{#if showDiff && turn.diff}
						<p class="editing-page__content"><DiffText segments={turn.diff} /></p>
					{:else}
						<p class="editing-page__content">{turn.content}</p>
					{/if}
					{#if turn.awarenesses.length > 0}
						<ul class="editing-page__awarenesses">
							{#each turn.awarenesses as awareness, i (i)}
								<li>💡 {awareness.personaName}: {awareness.content}</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
		{/each}
	</div>
</section>

<style>
	.editing-page__chapter-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}
	.editing-page__chapter-title {
		font-size: 1.5rem;
		font-weight: bold;
	}
	.editing-page__chapter-status {
		font-size: 0.75rem;
		padding: 1px 6px;
		border-radius: 3px;
		background: #eee;
		color: #757575;
	}
	.editing-page__chapter-status[data-status='completed'] {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.editing-page__chapter-status[data-status='failed'] {
		background: #ffebee;
		color: #c62828;
	}
	.editing-page__failure-reason {
		font-size: 0.78rem;
		color: #c62828;
	}
	.editing-page__turns {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.editing-page__turn {
		padding: 12px;
		border-left: 4px solid #e0e0e0;
	}
	.editing-page__turn.editing-page__turn--facilitator {
		border-left-color: #1565c0;
		background: #f8f9ff;
	}
	.editing-page__turn.editing-page__turn--removed {
		border-left-color: #e57373;
		background: #fff5f5;
	}
	.editing-page__turn.editing-page__turn--removed .editing-page__content del {
		color: #b31d28;
		text-decoration: line-through;
	}
	.editing-page__removed-label {
		font-size: 0.72rem;
		margin-left: 6px;
		color: #fff;
		background: #c62828;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.editing-page__speaker {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}
	.editing-page__speaker-name {
		font-weight: bold;
	}
	.editing-page__role {
		color: #757575;
		font-size: 0.875rem;
	}
	.editing-page__speech-mode {
		font-size: 0.75rem;
		color: #555;
		background: #eee;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.editing-page__content {
		margin: 0;
		line-height: 1.6;
	}
	.editing-page__awarenesses {
		margin-top: 8px;
		font-size: 0.85rem;
		color: var(--svelte-ui-text-subtle-color);
		list-style: none;
		padding: 0;
	}
</style>
