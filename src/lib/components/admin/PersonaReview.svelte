<script lang="ts">
	import { Button } from '@14ch/svelte-ui';

	interface PersonaProfile {
		id: string;
		name: string;
		stakeholderRole: string;
		age: number;
		occupation: string;
		background: string;
		stanceDirection: string;
	}

	interface Props {
		personas: PersonaProfile[];
		onApprove: () => void;
		onReject: () => void;
		loading?: boolean;
	}

	let { personas, onApprove, onReject, loading = false }: Props = $props();
</script>

<div class="review">
	<h2>ペルソナレビュー</h2>
	<ul class="list">
		{#each personas as p (p.id)}
			<li class="card">
				<div class="card-header">
					<strong class="name">{p.name}</strong>
					<span class="badge">{p.stakeholderRole}</span>
					<span class="badge stance">{p.stanceDirection}</span>
				</div>
				<dl class="attrs">
					<div><dt>年齢</dt><dd>{p.age}歳</dd></div>
					<div><dt>職業</dt><dd>{p.occupation}</dd></div>
					<div><dt>背景</dt><dd>{p.background}</dd></div>
				</dl>
			</li>
		{/each}
	</ul>
	<div class="actions">
		<Button variant="filled" onclick={onApprove} {loading}>承認して取材開始</Button>
		<Button variant="ghost" onclick={onReject} disabled={loading}>差し戻し</Button>
	</div>
</div>

<style>
	.review { padding: 16px; }
	.list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; }
	.card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
	.name { font-size: 1rem; }
	.badge { padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; background: #e3f2fd; color: #1565c0; }
	.stance { background: #e8f5e9; color: #2e7d32; }
	.attrs { display: flex; gap: 16px; margin: 0; font-size: 0.875rem; }
	.attrs div { display: flex; gap: 4px; }
	.attrs dt { color: #757575; }
	.actions { display: flex; gap: 8px; margin-top: 16px; }
</style>
