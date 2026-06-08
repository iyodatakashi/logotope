<script lang="ts">
	import { onMount } from 'svelte';
	import { createProgressStore } from '$lib/stores/progress.svelte.js';
	import * as api from '$lib/api/topics.js';

	interface Props {
		topicId: string;
		topicTitle: string;
	}
	let { topicId, topicTitle }: Props = $props();

	const progressStore = createProgressStore(topicId);

	interface Turn {
		id: string;
		turnIndex: number;
		speakerType: string;
		speakerName: string;
		speakerRole: string;
		content: string;
		beliefChangesTriggered: { personaName: string; changeType: string; changeSummary: string }[];
	}

	let sessionId = $state('');
	let turns = $state<Turn[]>([]);
	let loading = $state(true);
	let error = $state('');
	let publishUrl = $state('');

	async function load() {
		try {
			const data = await api.getAdminDebate(topicId);
			if (data.turns && data.turns.length > 0) {
				sessionId = data.id;
				turns = data.turns as Turn[];
				loading = false;
				return;
			}
		} catch {
			/* セッション未存在 */
		}
		try {
			const result = await api.startDebate(topicId);
			sessionId = result.debateSessionId;
			const data = await api.getAdminDebate(topicId);
			turns = (data.turns ?? []) as Turn[];
		} catch (e) {
			error = e instanceof Error ? e.message : '処理に失敗しました';
		} finally {
			loading = false;
		}
	}

	async function handleBack() {
		error = '';
		try {
			await api.resetToPhase3(topicId);
		} catch (e) {
			error = e instanceof Error ? e.message : '操作に失敗しました';
		}
	}

	async function handlePublish() {
		error = '';
		try {
			const result = await api.publishDebate(sessionId);
			publishUrl = result.url;
		} catch (e) {
			error = e instanceof Error ? e.message : '公開に失敗しました';
		}
	}

	const completedTurns = $derived(progressStore.progress?.completed ?? 0);
	const totalTurns = $derived(progressStore.progress?.total ?? 0);

	onMount(() => {
		progressStore.start();
		load();
		return () => progressStore.stop();
	});
</script>

<section>
	<h2>フェーズ 4: ディベート</h2>
	<p class="topic">{topicTitle}</p>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if loading}
		<p class="step" role="status">
			{progressStore.progress?.currentStep ?? '討論中...'}
			{#if totalTurns > 0}
				（ターン {completedTurns} / {totalTurns}）
			{/if}
		</p>
	{:else if turns.length > 0}
		<div class="turns">
			{#each turns as turn (turn.id)}
				<div class="turn" class:facilitator={turn.speakerType === 'facilitator'}>
					<div class="speaker">
						<strong>{turn.speakerName}</strong>
						{#if turn.speakerRole}
							<span class="role">({turn.speakerRole})</span>
						{/if}
					</div>
					<p class="content">{turn.content}</p>
					{#if turn.beliefChangesTriggered.length > 0}
						<ul class="beliefs">
							{#each turn.beliefChangesTriggered as bc}
								<li>🔄 {bc.personaName}: {bc.changeSummary}</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		</div>

		{#if publishUrl}
			<div class="publish-success">
				<p>公開しました: <a href={publishUrl} target="_blank">{publishUrl}</a></p>
			</div>
		{/if}
	{/if}

	<div class="actions">
		<button class="secondary" onclick={handleBack}>前のフェーズに戻る</button>
		{#if !loading && turns.length > 0 && !publishUrl}
			<button class="primary" onclick={handlePublish}>公開する</button>
		{/if}
	</div>
</section>

<style>
	section { padding: 16px; }
	.topic { color: #555; margin-bottom: 16px; }
	.step { color: #555; font-style: italic; }
	.error { color: #d32f2f; }
	.turns { display: flex; flex-direction: column; gap: 8px; }
	.turn { padding: 12px; border-left: 4px solid #e0e0e0; }
	.turn.facilitator { border-left-color: #1565c0; background: #f8f9ff; }
	.speaker { margin-bottom: 4px; }
	.role { color: #757575; font-size: 0.875rem; margin-left: 4px; }
	.content { margin: 0; line-height: 1.6; }
	.beliefs { margin-top: 8px; font-size: 0.85rem; color: #555; list-style: none; padding: 0; }
	.publish-success { background: #e8f5e9; padding: 16px; border-radius: 8px; margin-top: 16px; }
	.actions { margin-top: 16px; display: flex; gap: 8px; }
	.primary { padding: 10px 24px; background: #1565c0; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
	.primary:hover { background: #0d47a1; }
	.secondary { padding: 10px 24px; background: none; border: 1px solid #bbb; color: #555; border-radius: 4px; cursor: pointer; font-size: 1rem; }
	.secondary:hover { border-color: #555; }
</style>
