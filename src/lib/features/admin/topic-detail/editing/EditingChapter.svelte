<script lang="ts">
	import { Button } from '@14ch/svelte-ui';
	import DiffText from '$lib/sharedComponents/DiffText.svelte';
	import { computeInlineDiff } from '$lib/utils/inlineDiff';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
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

	// 話者名/役割を描画時に id から解決するための引き当て表は storeから直接読む（Turn と同じ責務境界）。
	const personaMap = $derived(currentTopicStore.personasStore.personaMap);

	const statusLabel = (s: EditedChapterDisplayStatus): string =>
		s === 'completed' ? '編集済み' : s === 'failed' ? '原本表示（失敗）' : '未編集';

	const contentById = $derived(new Map(sourceTurns.map((turn) => [turn.id, turn.content])));

	// 話者ラベルは Turn と同じく描画時に personaId から解決する（型には畳まない）。
	const speakerLabel = (turn: TurnForEditing) => {
		const persona = turn.personaId ? personaMap.get(turn.personaId) : null;
		return {
			name: persona?.name ?? 'ファシリテーター',
			role: persona?.specificRole ?? persona?.stakeholderRole ?? ''
		};
	};

	// 由来原本テキスト（sourceTurnIds 順に結合）↔ 編集後の差分を描画時に算出する（型には持たせない）。
	const diffOf = (turn: TurnForEditing) =>
		computeInlineDiff(
			turn.sourceTurnIds.map((id) => contentById.get(id) ?? '').join(''),
			turn.content
		);

	// 行の由来原本id群から気づきを引く（編集後は連結元、原本/削除は自id）。store から直接引く。
	const awarenessesOf = (turn: TurnForEditing) =>
		turn.sourceTurnIds.flatMap((id) => currentTopicStore.personasStore.getAwarenessesByTurn(id));

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
			{#if turn.removed}
				{#if showDiff}
					{@const speaker = speakerLabel(turn)}
					<div
						class="editing-chapter__turn editing-chapter__turn--removed"
						class:editing-chapter__turn--facilitator={turn.speakerType === 'facilitator'}
					>
						<div class="editing-chapter__speaker">
							<div class="editing-chapter__speaker-name">{speaker.name}</div>
							{#if speaker.role}<span class="editing-chapter__role">({speaker.role})</span>{/if}
							<span class="editing-chapter__removed-label">発言ごと削除</span>
						</div>
						<p class="editing-chapter__content"><del>{turn.content}</del></p>
					</div>
				{/if}
			{:else}
				{@const speaker = speakerLabel(turn)}
				{@const awarenesses = awarenessesOf(turn)}
				{@const diff = showDiff && status === 'completed' ? diffOf(turn) : null}
				<div
					class="editing-chapter__turn"
					class:editing-chapter__turn--facilitator={turn.speakerType === 'facilitator'}
				>
					<div class="editing-chapter__speaker">
						<div class="editing-chapter__speaker-name">{speaker.name}</div>
						{#if speaker.role}<span class="editing-chapter__role">（{speaker.role}）</span>{/if}
						{#if turn.speechMode}
							<span class="editing-chapter__speech-mode" data-mode={turn.speechMode}
								>{turn.speechMode}</span
							>
						{/if}
					</div>
					{#if diff}
						<p class="editing-chapter__content"><DiffText segments={diff} /></p>
					{:else}
						<p class="editing-chapter__content">{turn.content}</p>
					{/if}
					{#if awarenesses.length > 0}
						<ul class="editing-chapter__awarenesses">
							{#each awarenesses as awareness, i (i)}
								<li>💡 {personaMap.get(awareness.personaId)?.name ?? ''}: {awareness.content}</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/if}
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
	.editing-chapter__turn {
		padding: 12px;
		border-left: 4px solid #e0e0e0;
	}
	.editing-chapter__turn.editing-chapter__turn--facilitator {
		border-left-color: #1565c0;
		background: #f8f9ff;
	}
	.editing-chapter__turn.editing-chapter__turn--removed {
		border-left-color: #e57373;
		background: #fff5f5;
	}
	.editing-chapter__turn.editing-chapter__turn--removed .editing-chapter__content del {
		color: #b31d28;
		text-decoration: line-through;
	}
	.editing-chapter__removed-label {
		font-size: var(--svelte-ui-font-size-sm);
		margin-left: 6px;
		color: #fff;
		background: #c62828;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.editing-chapter__speaker {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}
	.editing-chapter__speaker-name {
		font-weight: bold;
	}
	.editing-chapter__role {
		font-size: var(--svelte-ui-font-size-sm);
		color: var(--svelte-ui-text-subtle-color);
	}
	.editing-chapter__speech-mode {
		font-size: var(--svelte-ui-font-size-sm);
		color: var(--svelte-ui-text-subtle-color);
		background: #eee;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.editing-chapter__content {
		margin: 0;
		line-height: 1.6;
	}
	.editing-chapter__awarenesses {
		margin-top: 8px;
		font-size: var(--svelte-ui-font-size-sm);
		color: var(--svelte-ui-text-subtle-color);
		list-style: none;
		padding: 0;
	}
</style>
