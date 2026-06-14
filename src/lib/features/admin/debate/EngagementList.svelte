<script lang="ts">
	import type { EngagementHistoryEntryWithPersona } from '$lib/stores/engagements.svelte.js';

	interface Props {
		engagements: ReadonlyArray<EngagementHistoryEntryWithPersona>;
		personaMap: Map<string, { name: string }>;
		selectedPersonaId?: string | null;
	}

	let { engagements, personaMap, selectedPersonaId = null }: Props = $props();

	// 現在のペルソナを起点にループし、各ペルソナのこのターンでの発言意欲を引く。
	// engagements 文書を起点にしないことで、古いペルソナidの残骸は原理的に表示されない。
	const items = $derived(
		[...personaMap].flatMap(([personaId, persona]) => {
			const entry = engagements.find((e) => e.personaId === personaId);
			return entry ? [{ personaId, name: persona.name, mode: entry.mode, score: entry.score }] : [];
		})
	);
</script>

{#if items.length > 0}
	<div class="engagements">
		{#each items as item}
			{@const selected = !!selectedPersonaId && item.personaId === selectedPersonaId}
			<span class="engagement" data-mode={item.mode} class:selected>
				{item.name}: {item.mode}({item.score}){#if selected}→選択{/if}
			</span>
		{/each}
	</div>
{/if}

<style>
	.engagements {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 6px;
	}
	.engagement {
		font-size: 0.72rem;
		padding: 1px 6px;
		border-radius: 3px;
		background: #eee;
		color: #555;
	}
	.engagement[data-mode='opinion'] {
		background: #e3f2fd;
		color: #1565c0;
	}
	.engagement[data-mode='fact'] {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.engagement[data-mode='reaction'] {
		background: #f3e5f5;
		color: #6a1b9a;
	}
	.engagement[data-mode='none'] {
		background: #f5f5f5;
		color: #999;
	}
	.engagement.selected {
		font-weight: 700;
		outline: 1px solid currentColor;
	}
</style>
