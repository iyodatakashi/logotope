<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { createTopicStore } from '$lib/stores/topic.svelte.js';
	import { createPersonasStore } from '$lib/stores/personas.svelte.js';
	import { createSessionStore } from '$lib/stores/session.svelte.js';
	import DebateViewer from '$lib/components/public/DebateViewer.svelte';
	import PostDebateComments from '$lib/components/public/PostDebateComments.svelte';
	import type {
		PublishedDebateDetail,
		PersonaSummaryForViewer,
		PublishedTurn,
		PublishedComment
	} from '$lib/types/index.js';

	const topicId = page.params.id as string;
	const topicStore = createTopicStore(topicId);
	const personasStore = createPersonasStore(topicId);
	const sessionStore = createSessionStore(topicId);

	const isLoaded = $derived(
		topicStore.isLoaded && personasStore.isLoaded && sessionStore.isLoaded
	);

	const personaMap = $derived(new Map(personasStore.personas.map((p) => [p.id, p])));

	const debate = $derived.by((): PublishedDebateDetail | null => {
		if (!topicStore.topic || !sessionStore.session) return null;
		const topic = topicStore.topic;
		const session = sessionStore.session;

		const personas: PersonaSummaryForViewer[] = personasStore.personas.map((p) => ({
			id: p.id,
			name: p.name,
			role: p.stakeholderRole,
			beliefHistory: (p.beliefs ?? []).map((b) => ({
				version: b.version,
				content: b.content,
				changeType: b.changeType,
				changeSummary: b.changeSummary,
				triggeredByTurnId: b.triggeredByTurnId
			}))
		}));

		const turns: PublishedTurn[] = (session.turns ?? [])
			.slice()
			.sort((a, b) => a.turnIndex - b.turnIndex)
			.map((t) => {
				const persona = t.personaId ? personaMap.get(t.personaId) : null;
				const beliefChangesTriggered = personasStore.personas.flatMap((p) =>
					(p.beliefs ?? [])
						.filter((b) => b.triggeredByTurnId === t.id && b.changeType && b.changeSummary)
						.map((b) => ({
							personaId: p.id,
							personaName: p.name,
							changeType: b.changeType!,
							changeSummary: b.changeSummary!
						}))
				);
				return {
					id: t.id,
					turnIndex: t.turnIndex,
					speakerType: t.speakerType,
					speakerName: persona?.name ?? 'ファシリテーター',
					speakerRole: persona?.stakeholderRole ?? '',
					content: t.content,
					beliefChangesTriggered,
					chapterIndex: t.chapterIndex
				};
			});

		const postDebateComments: PublishedComment[] = (session.postDebateComments ?? [])
			.slice()
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((c) => {
				const persona = personaMap.get(c.personaId);
				return {
					personaId: c.personaId,
					personaName: persona?.name ?? '',
					personaRole: persona?.stakeholderRole ?? '',
					content: c.content
				};
			});

		return { id: topic.id, topicTitle: topic.title, personas, turns, postDebateComments, chapters: session.chapters };
	});

	const personaNames = $derived(debate?.personas.map((p) => p.name).join('・') ?? '');

	onMount(() => {
		topicStore.start();
		personasStore.start();
		sessionStore.start();
		return () => {
			topicStore.stop();
			personasStore.stop();
			sessionStore.stop();
		};
	});
</script>

<svelte:head>
	<title>{debate?.topicTitle ?? 'logotope'} — logotope</title>
	<meta
		name="description"
		content="{debate ? `${debate.topicTitle}についての多角的な討論。${personaNames}が参加。` : ''}"
	/>
	<meta property="og:title" content="{debate?.topicTitle ?? 'logotope'} — logotope" />
	<meta
		property="og:description"
		content="{debate ? `${debate.topicTitle}についての多角的な討論。${personaNames}が参加。` : ''}"
	/>
</svelte:head>

<main class="container">
	<nav class="breadcrumb">
		<a href="/">← 討論一覧</a>
	</nav>

	{#if !isLoaded}
		<p class="loading">読み込み中...</p>
	{:else if !debate}
		<p class="loading">討論が見つかりません。</p>
	{:else}
		<header>
			<h1>{debate.topicTitle}</h1>
			<p class="meta">{debate.personas.length}名参加 · {debate.turns.length}ターン</p>
		</header>

		<DebateViewer {debate} />

		{#if debate.postDebateComments.length > 0}
			<PostDebateComments comments={debate.postDebateComments} />
		{/if}
	{/if}
</main>

<style>
	.container {
		max-width: 960px;
		margin: 0 auto;
		padding: 24px 16px;
	}
	.breadcrumb {
		margin-bottom: 16px;
	}
	.breadcrumb a {
		color: #1565c0;
		text-decoration: none;
		font-size: 0.875rem;
	}
	header {
		margin-bottom: 24px;
	}
	h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 8px;
	}
	.meta {
		color: #757575;
		font-size: 0.875rem;
		margin: 0;
	}
	.loading {
		color: #757575;
	}
</style>
