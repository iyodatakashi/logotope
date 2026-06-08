<script lang="ts">
	import { Button } from '@14ch/svelte-ui';

	interface BeliefChangeTrigger {
		personaId: string;
		personaName: string;
		changeType: string;
		changeSummary: string;
	}

	interface TurnData {
		id: string;
		turnIndex: number;
		speakerType: string;
		speakerName: string;
		speakerRole: string;
		content: string;
		beliefChangesTriggered: BeliefChangeTrigger[];
	}

	interface Props {
		turns: TurnData[];
		onPublish: () => void;
		publishUrl?: string;
		loading?: boolean;
	}

	let { turns, onPublish, publishUrl = '', loading = false }: Props = $props();
</script>

<div class="preview">
	<h2>討論プレビュー（{turns.length} ターン）</h2>

	<ul class="turns">
		{#each turns.sort((a, b) => a.turnIndex - b.turnIndex) as turn (turn.id)}
			<li class="turn {turn.speakerType}">
				<div class="turn-header">
					<span class="speaker">{turn.speakerName}</span>
					{#if turn.speakerRole}
						<span class="role">（{turn.speakerRole}）</span>
					{/if}
					{#if turn.beliefChangesTriggered.length > 0}
						<span class="belief-badge">信念変化</span>
					{/if}
				</div>
				<p class="content">{turn.content}</p>
				{#if turn.beliefChangesTriggered.length > 0}
					<ul class="belief-changes">
						{#each turn.beliefChangesTriggered as bc}
							<li>{bc.personaName}: {bc.changeSummary}</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>

	<div class="publish-area">
		{#if publishUrl}
			<p class="url">公開 URL: <a href={publishUrl} target="_blank">{publishUrl}</a></p>
		{:else}
			<Button variant="filled" onclick={onPublish} {loading}>公開する</Button>
		{/if}
	</div>
</div>

<style>
	.preview { padding: 16px; }
	.turns { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.turn { padding: 12px; border-radius: 8px; border-left: 4px solid #e0e0e0; }
	.turn.facilitator { border-left-color: #7b1fa2; background: #f3e5f5; }
	.turn.persona { border-left-color: #1565c0; background: #e3f2fd; }
	.turn-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
	.speaker { font-weight: 600; }
	.role { color: #757575; font-size: 0.875rem; }
	.belief-badge { padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; background: #ff8f00; color: white; }
	.content { margin: 0; }
	.belief-changes { margin: 8px 0 0; font-size: 0.875rem; color: #555; }
	.publish-area { margin-top: 24px; }
	.url { color: #2e7d32; }
</style>
