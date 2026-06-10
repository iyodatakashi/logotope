<script lang="ts">
	import { onMount } from 'svelte';
	import { createPersonasStore } from '$lib/stores/personas.svelte.js';
	import { createTopicStore } from '$lib/stores/topic.svelte.js';
	import { createSessionStore } from '$lib/stores/session.svelte.js';
	import { createEngagementsStore } from '$lib/stores/engagements.svelte.js';
	import { startDebate } from '$lib/api/topics.js';

	interface Props {
		topicId: string;
		topicTitle: string;
	}
	let { topicId, topicTitle }: Props = $props();

	const sessionStore = createSessionStore(topicId);
	const personasStore = createPersonasStore(topicId);
	const topicStore = createTopicStore(topicId);
	const engagementsStore = createEngagementsStore(topicId);

	let starting = $state(false);
	let started = $state(false);
	let error = $state('');
	let publishUrl = $state('');

	const personaMap = $derived(new Map(personasStore.personas.map((p) => [p.id, p])));

	const turns = $derived(
		(sessionStore.session?.turns ?? [])
			.slice()
			.sort((a, b) => a.turnIndex - b.turnIndex)
			.map((t) => {
				const persona = t.personaId ? personaMap.get(t.personaId) : null;
				return {
					id: t.id,
					turnIndex: t.turnIndex,
					speakerType: t.speakerType,
					speakerName: t.speakerName ?? persona?.name ?? 'ファシリテーター',
					speakerRole: t.speakerRole ?? persona?.stakeholderRole ?? '',
					content: t.content,
					speechMode: t.speechMode,
					personaId: t.personaId,
					engagements: (engagementsStore.engagementsMap.get(t.turnIndex) ?? []).map((e) => ({
						...e,
						name: personaMap.get(e.personaId)?.name ?? e.personaId,
					})),
					beliefChangesTriggered: personasStore.personas.flatMap((p) =>
						(p.beliefs ?? [])
							.filter((b) => b.triggeredByTurnId === t.id)
							.map((b) => ({
								personaName: p.name,
								changeType: b.changeType ?? '',
								changeSummary: b.changeSummary ?? ''
							}))
					)
				};
			})
	);

	const isDebating = $derived(sessionStore.session?.status === 'debating');
	const loading = $derived(!sessionStore.isLoaded || starting || isDebating);
	const completedTurns = $derived(turns.length);
	const totalTurns = $derived(sessionStore.session?.totalTurns ?? 0);
	const isStopped = $derived(!!error && !starting);

	const chapters = $derived(sessionStore.session?.chapters ?? null);
	const currentChapterIndex = $derived(sessionStore.session?.currentChapterIndex ?? null);
	const currentChapter = $derived(
		chapters && currentChapterIndex !== null ? chapters[currentChapterIndex] : null
	);

	$effect(() => {
		if (sessionStore.isLoaded && !sessionStore.session && !started) {
			void doStart();
		}
	});

	async function doStart() {
		started = true;
		starting = true;
		error = '';
		try {
			await startDebate(topicId);
		} catch (e) {
			error = e instanceof Error ? e.message : '処理に失敗しました';
		} finally {
			starting = false;
		}
	}

	async function handleBack() {
		error = '';
		try {
			await topicStore.resetToPhase3();
		} catch (e) {
			error = e instanceof Error ? e.message : '操作に失敗しました';
		}
	}

	async function handlePublish() {
		error = '';
		try {
			await topicStore.publishDebate();
			publishUrl = `/debate/${topicId}`;
		} catch (e) {
			error = e instanceof Error ? e.message : '公開に失敗しました';
		}
	}

	onMount(() => {
		sessionStore.start();
		personasStore.start();
		topicStore.start();
		engagementsStore.start();
		return () => {
			sessionStore.stop();
			personasStore.stop();
			topicStore.stop();
			engagementsStore.stop();
		};
	});
</script>

<section>
	<h2>フェーズ 4: ディベート</h2>
	<p class="topic">{topicTitle}</p>

	{#if isStopped}
		<p class="status-stopped" role="alert">討論停止: {error}</p>
	{:else if loading}
		<p class="step" role="status">
			{#if currentChapter}
				第{(currentChapterIndex ?? 0) + 1}章「{currentChapter.title}」
				{#if chapters}（第{(currentChapterIndex ?? 0) + 1}章 / 全{chapters.length}章）{/if}
			{:else}
				討論中...
				{#if totalTurns > 0}（ターン {completedTurns} / {totalTurns}）{/if}
			{/if}
		</p>
	{/if}

	{#if turns.length > 0}
		<div class="turns">
			{#each turns as turn (turn.id)}
				<div class="turn" class:facilitator={turn.speakerType === 'facilitator'}>
					<div class="speaker">
						<strong>{turn.speakerName}</strong>
						{#if turn.speakerRole}
							<span class="role">({turn.speakerRole})</span>
						{/if}
						{#if turn.speechMode}
							<span class="speech-mode">[{turn.speechMode}]</span>
						{/if}
					</div>
					<p class="content">{turn.content}</p>
					{#if turn.engagements.length > 0}
						<div class="engagements">
							{#each turn.engagements as e}
								{@const selected = e.personaId === turn.personaId}
								<span class="engagement" data-mode={e.mode} class:selected>
									{e.name}: {e.mode}({e.score}){#if selected} →選択{/if}
								</span>
							{/each}
						</div>
					{/if}
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
	.step { color: #1565c0; font-style: italic; }
	.status-stopped { color: #e65100; font-weight: 600; }
	.turns { display: flex; flex-direction: column; gap: 8px; }
	.turn { padding: 12px; border-left: 4px solid #e0e0e0; }
	.turn.facilitator { border-left-color: #1565c0; background: #f8f9ff; }
	.speaker { margin-bottom: 4px; }
	.role { color: #757575; font-size: 0.875rem; margin-left: 4px; }
	.speech-mode { font-size: 0.75rem; margin-left: 6px; color: #fff; background: #888; padding: 1px 5px; border-radius: 3px; }
	.speech-mode:has(+ *) { /* nothing */ }
	.content { margin: 0; line-height: 1.6; }
	.engagements { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
	.engagement { font-size: 0.72rem; padding: 1px 6px; border-radius: 3px; background: #eee; color: #555; }
	.engagement[data-mode='full'] { background: #e3f2fd; color: #1565c0; }
	.engagement[data-mode='reaction'] { background: #f3e5f5; color: #6a1b9a; }
	.engagement[data-mode='none'] { background: #f5f5f5; color: #999; }
	.engagement.selected { font-weight: 700; outline: 1px solid currentColor; }
	.beliefs { margin-top: 8px; font-size: 0.85rem; color: #555; list-style: none; padding: 0; }
	.publish-success { background: #e8f5e9; padding: 16px; border-radius: 8px; margin-top: 16px; }
	.actions { margin-top: 16px; display: flex; gap: 8px; }
	.primary { padding: 10px 24px; background: #1565c0; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
	.primary:hover { background: #0d47a1; }
	.secondary { padding: 10px 24px; background: none; border: 1px solid #bbb; color: #555; border-radius: 4px; cursor: pointer; font-size: 1rem; }
	.secondary:hover { border-color: #555; }
</style>
