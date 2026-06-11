<script lang="ts">
	import { onMount } from 'svelte';
	import { createPersonasStore } from '$lib/stores/personas.svelte.js';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { createSessionStore } from '$lib/stores/session.svelte.js';
	import { createEngagementsStore } from '$lib/stores/engagements.svelte.js';
	import { startDebate } from '$lib/api/topics.js';

	interface Props {
		topicId: string;
		topicTitle: string;
		readonly?: boolean;
	}
	let { topicId, topicTitle, readonly = false }: Props = $props();

	// svelte-ignore state_referenced_locally -- ストアはマウント時の topicId に束縛する
	const sessionStore = createSessionStore(topicId);
	// svelte-ignore state_referenced_locally -- 同上
	const personasStore = createPersonasStore(topicId);
	// svelte-ignore state_referenced_locally -- 同上
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
					fromQueue: t.fromQueue,
					personaId: t.personaId,
					engagements: (engagementsStore.engagementsMap.get(t.turnIndex) ?? []).map((e) => ({
						...e,
						name: personaMap.get(e.personaId)?.name ?? e.personaId
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
		if (!readonly && sessionStore.isLoaded && !sessionStore.session && !started) {
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

	async function handlePublish() {
		error = '';
		try {
			await currentTopicStore.topic?.publishDebate();
			publishUrl = `/debate/${topicId}`;
		} catch (e) {
			error = e instanceof Error ? e.message : '公開に失敗しました';
		}
	}

	onMount(() => {
		sessionStore.start();
		personasStore.start();
		engagementsStore.start();
		return () => {
			sessionStore.stop();
			personasStore.stop();
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

	{#if chapters}
		<ol class="chapters">
			{#each chapters as chapter}
				<li class:current={chapter.index === (currentChapterIndex ?? 0)}>
					<strong>{chapter.title}</strong>
					<span class="focus">{chapter.focusQuestion}</span>
				</li>
			{/each}
		</ol>
	{/if}

	{#if turns.length > 0}
		<div class="turns">
			{#each turns as turn, i (turn.id)}
				<div class="turn" class:facilitator={turn.speakerType === 'facilitator'}>
					<div class="speaker">
						<strong>{turn.speakerName}</strong>
						{#if turn.speakerRole}
							<span class="role">({turn.speakerRole})</span>
						{/if}
						{#if turn.speechMode}
							<span class="speech-mode">[{turn.speechMode}]</span>
						{/if}
						{#if turn.fromQueue}
							<span class="from-queue">[キュー]</span>
						{/if}
					</div>
					<p class="content">{turn.content}</p>
					{#if turn.engagements.length > 0}
						{@const nextPersonaId = turns[i + 1]?.personaId}
						<div class="engagements">
							{#each turn.engagements as e}
								{@const selected = !!nextPersonaId && e.personaId === nextPersonaId}
								<span class="engagement" data-mode={e.mode} class:selected>
									{e.name}: {e.mode}({e.score}){#if selected}
										→選択{/if}
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

	{#if !readonly && !loading && turns.length > 0 && !publishUrl}
		<div class="actions">
			<button class="primary" onclick={handlePublish}>公開する</button>
		</div>
	{/if}
</section>

<style>
	section {
		padding: 16px;
	}
	.topic {
		color: #555;
		margin-bottom: 16px;
	}
	.step {
		color: #1565c0;
		font-style: italic;
	}
	.status-stopped {
		color: #e65100;
		font-weight: 600;
	}
	.chapters {
		margin: 12px 0;
		padding-left: 24px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.chapters li {
		color: #888;
		font-size: 0.9rem;
	}
	.chapters li.current {
		color: #1565c0;
		font-weight: 600;
	}
	.focus {
		margin-left: 8px;
		font-weight: normal;
		color: #aaa;
		font-size: 0.85rem;
	}
	.chapters li.current .focus {
		color: #5c8fd6;
	}
	.turns {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.turn {
		padding: 12px;
		border-left: 4px solid #e0e0e0;
	}
	.turn.facilitator {
		border-left-color: #1565c0;
		background: #f8f9ff;
	}
	.speaker {
		margin-bottom: 4px;
	}
	.role {
		color: #757575;
		font-size: 0.875rem;
		margin-left: 4px;
	}
	.speech-mode {
		font-size: 0.75rem;
		margin-left: 6px;
		color: #fff;
		background: #888;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.from-queue {
		font-size: 0.75rem;
		margin-left: 4px;
		color: #fff;
		background: #e65100;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.content {
		margin: 0;
		line-height: 1.6;
	}
	.engagements {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 6px;
	}
	.engagement {
		font-size: 0.72rem;
		padding: 1px 6px;
		border-radius: 3px;
		background: #eee;
		color: #555;
	}
	.engagement[data-mode='full'] {
		background: #e3f2fd;
		color: #1565c0;
	}
	.engagement[data-mode='reaction'] {
		background: #f3e5f5;
		color: #6a1b9a;
	}
	.engagement[data-mode='none'] {
		background: #f5f5f5;
		color: #999;
	}
	.engagement.selected {
		font-weight: 700;
		outline: 1px solid currentColor;
	}
	.beliefs {
		margin-top: 8px;
		font-size: 0.85rem;
		color: #555;
		list-style: none;
		padding: 0;
	}
	.publish-success {
		background: #e8f5e9;
		padding: 16px;
		border-radius: 8px;
		margin-top: 16px;
	}
	.actions {
		margin-top: 16px;
		display: flex;
		gap: 8px;
	}
	.primary {
		padding: 10px 24px;
		background: #1565c0;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 1rem;
	}
	.primary:hover {
		background: #0d47a1;
	}
</style>
