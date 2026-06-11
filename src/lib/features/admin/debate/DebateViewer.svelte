<script lang="ts">
	import type { PublishedDebateDetail, PublishedTurn, ChapterDoc } from '$lib/models/session/session.types.js';
	import TurnDisplay from './TurnDisplay.svelte';
	import PersonaFilter from './PersonaFilter.svelte';
	import BeliefEvolution from '$lib/features/admin/debate/BeliefEvolution.svelte';

	interface Props {
		debate: PublishedDebateDetail;
		selectedPersonaId?: string | null;
	}

	let { debate, selectedPersonaId = $bindable(null) }: Props = $props();

	const filteredTurns = $derived(
		selectedPersonaId
			? debate.turns.filter(
					(t) =>
						t.speakerType === 'persona' &&
						t.speakerName === debate.personas.find((p) => p.id === selectedPersonaId)?.name
				)
			: debate.turns
	);

	type DisplayItem =
		| { type: 'turn'; key: string; turn: PublishedTurn }
		| { type: 'chapter'; key: string; chapter: ChapterDoc };

	const displayItems = $derived.by((): DisplayItem[] => {
		if (!debate.chapters) {
			return filteredTurns.map((t) => ({ type: 'turn' as const, key: t.id, turn: t }));
		}
		const items: DisplayItem[] = [];
		let lastChapterIndex: number | undefined = undefined;
		for (const turn of filteredTurns) {
			if (turn.chapterIndex !== undefined && turn.chapterIndex !== lastChapterIndex) {
				const chapter = debate.chapters!.find((c) => c.index === turn.chapterIndex);
				if (chapter) {
					items.push({ type: 'chapter', key: `ch-${chapter.index}`, chapter });
					lastChapterIndex = turn.chapterIndex;
				}
			}
			items.push({ type: 'turn', key: turn.id, turn });
		}
		return items;
	});
</script>

<div class="viewer">
	<div class="sidebar">
		<PersonaFilter personas={debate.personas} bind:selectedPersonaId />
		{#if selectedPersonaId}
			{@const persona = debate.personas.find((p) => p.id === selectedPersonaId)}
			{#if persona}
				<BeliefEvolution {persona} turns={debate.turns} />
			{/if}
		{/if}
	</div>

	<div class="turns">
		{#each displayItems as item (item.key)}
			{#if item.type === 'chapter'}
				<div class="chapter-header">
					<h3>第{item.chapter.index + 1}章「{item.chapter.title}」</h3>
					<p class="focus-question">{item.chapter.focusQuestion}</p>
				</div>
			{:else}
				<TurnDisplay turn={item.turn} />
			{/if}
		{/each}
	</div>
</div>

<style>
	.viewer {
		display: grid;
		grid-template-columns: 240px 1fr;
		gap: 24px;
		align-items: start;
	}
	@media (max-width: 640px) {
		.viewer {
			grid-template-columns: 1fr;
		}
	}
	.sidebar {
		position: sticky;
		top: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.turns {
		min-width: 0;
	}
	.chapter-header {
		margin: 24px 0 8px;
		padding: 12px 16px;
		border-left: 4px solid #1565c0;
		background: #f0f4ff;
		border-radius: 0 4px 4px 0;
	}
	.chapter-header h3 {
		font-size: 1rem;
		font-weight: 700;
		color: #1565c0;
		margin: 0 0 4px;
	}
	.focus-question {
		font-size: 0.875rem;
		color: #555;
		margin: 0;
		font-style: italic;
	}
</style>
