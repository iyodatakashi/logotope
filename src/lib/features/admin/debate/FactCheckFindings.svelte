<script lang="ts">
	import type { FactCheckFinding } from '$lib/models/factCheck/factCheck.types';

	interface Props {
		findings: ReadonlyArray<FactCheckFinding>;
	}

	let { findings }: Props = $props();
</script>

{#if findings.length > 0}
	<div class="fact-check">
		{#each findings as finding (finding.id)}
			<div class="finding" data-verdict={finding.verdict}>
				<p class="badge" data-verdict={finding.verdict}>
					{finding.verdict === 'incorrect' ? '事実と異なる' : '検証不能'}
				</p>
				<p class="claim">「{finding.claim}」</p>
				{#if finding.verdict === 'incorrect'}
					<p class="correction"><span class="label">正しい事実:</span> {finding.correction}</p>
				{/if}
				<p class="reason"><span class="label">理由:</span> {finding.reason}</p>
				{#if finding.sources.length > 0}
					<ul class="sources">
						{#each finding.sources as source (source.url)}
							<li>
								<a href={source.url} target="_blank" rel="noopener noreferrer"
									>{source.title || source.url}</a
								>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.fact-check {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 6px;
	}
	.finding {
		border-left: 3px solid #d32f2f;
		background: #fff5f5;
		padding: 6px 10px;
		font-size: 0.82rem;
	}
	.finding[data-verdict='unverifiable'] {
		border-left-color: #9e9e9e;
		background: #fafafa;
	}
	.claim {
		margin: 0 0 4px;
		font-weight: 600;
		color: #b71c1c;
	}
	.finding[data-verdict='unverifiable'] .claim {
		color: #616161;
	}
	.correction,
	.reason {
		margin: 2px 0;
		color: #333;
	}
	.label {
		font-weight: 600;
	}
	.badge {
		margin: 0 0 4px;
		display: inline-block;
		font-size: 0.72rem;
		font-weight: 700;
		padding: 1px 6px;
		border-radius: 3px;
		background: #eeeeee;
		color: #616161;
	}
	.badge[data-verdict='incorrect'] {
		background: #ffebee;
		color: #b71c1c;
	}
	.sources {
		margin: 4px 0 0;
		padding-left: 18px;
		font-size: 0.78rem;
	}
	.sources a {
		color: #1565c0;
	}
</style>
