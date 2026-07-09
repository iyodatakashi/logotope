<script lang="ts">
	import type { EngagementHistoryEntryWithPersona } from '$lib/models/engagement/engagement.types';

	interface Props {
		engagements: ReadonlyArray<EngagementHistoryEntryWithPersona>;
		personaMap: Map<string, { name: string }>;
		selectedPersonaId?: string | null;
	}

	let { engagements, personaMap, selectedPersonaId = null }: Props = $props();

	// 現在のペルソナを起点にループし、各ペルソナのこのターンでの発言意欲を引く。
	// engagements 文書を起点にしないことで、古いペルソナidの残骸は原理的に表示されない。
	// 話者名は型に畳まず personaId 参照のまま保持し、描画時に personaMap で解決する（Req 3.1）。
	const items = $derived(
		[...personaMap].flatMap(([personaId]) => {
			const entry = engagements.find((engagement) => engagement.personaId === personaId);
			return entry ? [{ personaId, mode: entry.mode, score: entry.score }] : [];
		})
	);
</script>

{#if items.length > 0}
	<div class="engagement-list">
		{#each items as item (item.personaId)}
			{@const selected = !!selectedPersonaId && item.personaId === selectedPersonaId}
			<span
				class="engagement-list__engagement"
				data-mode={item.mode}
				class:engagement-list__engagement--selected={selected}
			>
				{personaMap.get(item.personaId)?.name ?? ''}: {item.mode}({item.score}){#if selected}→選択{/if}
			</span>
		{/each}
	</div>
{/if}

<style>
	.engagement-list {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 6px;
	}
	.engagement-list__engagement {
		font-size: 0.72rem;
		padding: 1px 6px;
		border-radius: 3px;
		background: #eee;
		color: #555;
	}
	.engagement-list__engagement[data-mode='opinion'] {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.engagement-list__engagement[data-mode='fact'] {
		background: #e3f2fd;
		color: #1565c0;
	}
	.engagement-list__engagement[data-mode='question'] {
		background: #fff3e0;
		color: #e65100;
	}
	.engagement-list__engagement[data-mode='none'] {
		background: #f5f5f5;
		color: #999;
	}
	.engagement-list__engagement.engagement-list__engagement--selected {
		font-weight: 700;
		outline: 1px solid currentColor;
	}
</style>
