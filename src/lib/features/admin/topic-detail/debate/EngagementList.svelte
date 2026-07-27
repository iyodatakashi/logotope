<script lang="ts">
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';

	interface Props {
		turnId: string;
		selectedPersonaId?: string | null; // 次に選ばれた話者（生成開始時に pendingTurn として確定）
	}

	let { turnId, selectedPersonaId = null }: Props = $props();

	// 話者名・このターンの各ペルソナの発言意欲は、いずれも storeから直接引く。
	const engagements = $derived(currentTopicStore.engagementsStore.engagementsMap.get(turnId) ?? []);

	// 現在のペルソナを起点にループし、各ペルソナのこのターンでの発言意欲を引く。
	// engagements 文書を起点にしないことで、古いペルソナidの残骸は原理的に表示されない。
	// 話者名は型に畳まず personaId 参照のまま保持し、描画時に store の解決メソッドで解決する（Req 3.1）。
	const items = $derived(
		currentTopicStore.personasStore.personas.flatMap((persona) => {
			const entry = engagements.find((engagement) => engagement.personaId === persona.id);
			return entry ? [{ personaId: persona.id, mode: entry.mode, score: entry.score }] : [];
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
				{currentTopicStore.personasStore.getPersona(item.personaId)?.name ?? ''}: {item.mode}({item.score})
			</span>
		{/each}
	</div>
{/if}

<style>
	.engagement-list {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.engagement-list__engagement {
		font-size: var(--svelte-ui-font-size-sm);
		padding: 0 8px;
		border-radius: 3px;
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
