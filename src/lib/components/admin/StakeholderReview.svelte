<script lang="ts">
	import { Button } from '@14ch/svelte-ui';

	interface Stakeholder {
		id: string;
		role: string;
		stanceDirection: string;
		minorityLevel: string;
		rationale: string;
	}

	interface Props {
		stakeholders: Stakeholder[];
		onApprove: () => void;
		onReject: () => void;
		loading?: boolean;
	}

	let { stakeholders, onApprove, onReject, loading = false }: Props = $props();
</script>

<div class="review">
	<h2>ステークホルダーレビュー</h2>
	<ul class="list">
		{#each stakeholders as sh (sh.id)}
			<li class="card">
				<div class="card-header">
					<strong class="role">{sh.role}</strong>
					<span class="badge">{sh.stanceDirection}</span>
					<span class="badge minority">{sh.minorityLevel}</span>
				</div>
				<p class="rationale">{sh.rationale}</p>
			</li>
		{/each}
	</ul>
	<div class="actions">
		<Button variant="filled" onclick={onApprove} {loading}>承認</Button>
		<Button variant="ghost" onclick={onReject} disabled={loading}>差し戻し</Button>
	</div>
</div>

<style>
	.review { padding: 16px; }
	.list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; }
	.card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
	.role { font-size: 1rem; }
	.badge { padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; background: #e3f2fd; color: #1565c0; }
	.minority { background: #fce4ec; color: #c62828; }
	.rationale { color: #555; font-size: 0.875rem; }
	.actions { display: flex; gap: 8px; margin-top: 16px; }
</style>
