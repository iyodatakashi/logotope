<script lang="ts">
	import { Button } from '@14ch/svelte-ui';

	interface InterviewData {
		personaId: string;
		personaName: string;
		interviewRecord: string;
		status: string;
	}

	interface Props {
		interviews: InterviewData[];
		onApprove: () => void;
		onRetry?: (personaId: string) => void;
		loading?: boolean;
	}

	let { interviews, onApprove, onRetry, loading = false }: Props = $props();

	const allCompleted = $derived(interviews.every((i) => i.status === 'completed'));
</script>

<div class="review">
	<h2>取材レコードレビュー</h2>
	<ul class="list">
		{#each interviews as interview (interview.personaId)}
			<li class="card">
				<div class="card-header">
					<strong>{interview.personaName}</strong>
					<span class="badge status-{interview.status}">
						{interview.status === 'completed' ? '完了' : interview.status === 'error' ? 'エラー' : '処理中'}
					</span>
				</div>
				{#if interview.status === 'completed' && interview.interviewRecord}
					<p class="record">{interview.interviewRecord}</p>
				{/if}
				{#if interview.status === 'error' && onRetry}
					<Button variant="outlined" size="small" onclick={() => onRetry!(interview.personaId)}>
						再試行
					</Button>
				{/if}
			</li>
		{/each}
	</ul>
	{#if allCompleted}
		<div class="actions">
			<Button variant="filled" onclick={onApprove} {loading}>承認して討論を開始</Button>
		</div>
	{/if}
</div>

<style>
	.review { padding: 16px; }
	.list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; }
	.card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
	.badge { padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; }
	.status-completed { background: #c8e6c9; color: #2e7d32; }
	.status-error { background: #ffcdd2; color: #c62828; }
	.record { font-size: 0.875rem; color: #555; white-space: pre-line; }
	.actions { margin-top: 16px; }
</style>
