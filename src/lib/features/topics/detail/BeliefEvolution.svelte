<script lang="ts">
	import type { PersonaSummaryForViewer } from '$lib/models/persona/persona.types';
	import type { PublishedTurn } from '$lib/models/session/session.types';

	interface Props {
		persona: PersonaSummaryForViewer;
		turns: PublishedTurn[];
	}

	let { persona, turns }: Props = $props();

	const initialBelief = $derived(persona.beliefHistory[0]);
	const finalBelief = $derived(persona.beliefHistory[persona.beliefHistory.length - 1]);
	const changes = $derived(persona.beliefHistory.filter((b) => b.version > 0 && b.changeType));

	function renderMarkdown(md: string): string {
		return md
			.replace(/^# (.+)$/gm, '<h3>$1</h3>')
			.replace(/^## (.+)$/gm, '<h4>$1</h4>')
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replace(/\n/g, '<br>');
	}

	function getTurnIndex(turnId: string): number | null {
		const t = turns.find((t) => t.id === turnId);
		return t?.turnIndex ?? null;
	}
</script>

<div class="belief-evolution">
	<h3 class="persona-name">{persona.name}</h3>
	<p class="persona-role">{persona.role}</p>

	<section class="belief-section">
		<h4>初期信念</h4>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		<div class="belief-content">{@html renderMarkdown(initialBelief.content)}</div>
	</section>

	{#if changes.length > 0}
		<section class="belief-section">
			<h4>信念の変化</h4>
			<ul data-testid="belief-change-list" class="change-list">
				{#each changes as change}
					<li class="change-item">
						<span class="change-type change-{change.changeType}">
							{change.changeType === 'opinion_change' ? '意見変化' : '部分承認'}
						</span>
						<span class="change-summary">{change.changeSummary}</span>
						{#if change.triggeredByTurnId}
							{@const idx = getTurnIndex(change.triggeredByTurnId)}
							{#if idx !== null}
								<a href="#turn-{idx}" class="turn-link">→ターン{idx}</a>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if finalBelief.version > 0}
		<section class="belief-section">
			<h4>最終信念</h4>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<div class="belief-content">{@html renderMarkdown(finalBelief.content)}</div>
		</section>
	{/if}
</div>

<style>
	.belief-evolution {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		padding: 16px;
		font-size: 0.875rem;
	}
	.persona-name {
		font-weight: 700;
		margin: 0 0 2px;
		font-size: 1rem;
	}
	.persona-role {
		color: #757575;
		margin: 0 0 12px;
		font-size: 0.8rem;
	}
	.belief-section {
		margin-bottom: 12px;
	}
	.belief-section h4 {
		font-size: 0.8rem;
		font-weight: 600;
		color: #555;
		margin: 0 0 4px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.belief-content {
		background: #fafafa;
		border-radius: 4px;
		padding: 8px;
		line-height: 1.5;
	}
	.change-list {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.change-item {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		flex-wrap: wrap;
	}
	.change-type {
		font-size: 0.7rem;
		padding: 1px 6px;
		border-radius: 4px;
		flex-shrink: 0;
	}
	.change-opinion_change {
		background: #ffe0b2;
		color: #e65100;
	}
	.change-partial_acceptance {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.change-summary {
		flex: 1;
	}
	.turn-link {
		color: #1565c0;
		text-decoration: none;
		font-size: 0.75rem;
	}
</style>
