<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { topicsStore } from '$lib/stores/topics.svelte';
	import { createPersonasStore } from '$lib/stores/personas.svelte';
	import { createChaptersStore } from '$lib/stores/chapters.svelte';
	import { createPostDebateCommentsStore } from '$lib/stores/postDebateComments.svelte';
	import DebateViewer from '$lib/features/topics/detail/DebateViewer.svelte';
	import PostDebateComments from '$lib/sharedComponents/PostDebateComments.svelte';
	import type { PersonaSummaryForViewer } from '$lib/models/persona/persona.types';
	import type {
		PublishedDebateDetail,
		PublishedTurn,
		PublishedComment
	} from '$lib/models/session/session.types';

	const topicId = page.params.topicId as string;
	const personasStore = createPersonasStore(topicId);
	const chaptersStore = createChaptersStore(topicId);
	const postDebateCommentsStore = createPostDebateCommentsStore(topicId);

	const currentTopic = $derived(topicsStore.topics.find((topic) => topic.id === topicId));
	const isLoaded = $derived(
		topicsStore.isLoaded && personasStore.isLoaded && chaptersStore.isLoaded
	);

	const personaMap = $derived(new Map(personasStore.personas.map((p) => [p.id, p])));

	const debate = $derived.by((): PublishedDebateDetail | null => {
		if (!currentTopic || !chaptersStore.chapters.length) return null;
		const topic = currentTopic;

		const personas: PersonaSummaryForViewer[] = personasStore.personas.map((p) => ({
			id: p.id,
			name: p.name,
			role: p.specificRole ?? p.stakeholderRole,
			beliefHistory: (p.beliefs ?? []).map((b) => ({
				version: b.version,
				content: b.content,
				changeType: b.changeType,
				changeSummary: b.changeSummary,
				triggeredByTurnId: b.triggeredByTurnId
			}))
		}));

		const allTurns = chaptersStore.turns;

		const turns: PublishedTurn[] = allTurns.map((t) => {
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
				speakerType: t.speakerType,
				personaId: t.personaId ?? null,
				speakerName: persona?.name ?? 'ファシリテーター',
				speakerRole: persona?.specificRole ?? persona?.stakeholderRole ?? '',
				content: t.content,
				beliefChangesTriggered
			};
		});

		let cumulativeTurns = 0;
		const chapters = chaptersStore.chapters.map((c) => {
			const startTurnIdx = cumulativeTurns;
			cumulativeTurns += c.turns.length;
			return {
				title: c.title,
				focusQuestion: c.focusQuestion,
				discussionPoints: c.discussionPoints,
				startTurnIdx
			};
		});

		const comments = postDebateCommentsStore.comments;
		const commentMap = new Map(comments.map((c) => [c.personaId, c]));
		const postDebateComments: PublishedComment[] = personasStore.personas.flatMap((p) => {
			const comment = commentMap.get(p.id);
			return comment
				? [
						{
							personaId: p.id,
							personaName: p.name,
							personaRole: p.specificRole ?? p.stakeholderRole,
							content: comment.content
						}
					]
				: [];
		});

		return {
			id: topic.id,
			topicTitle: topic.title,
			personas,
			turns,
			postDebateComments,
			chapters
		};
	});

	const personaNames = $derived(debate?.personas.map((p) => p.name).join('・') ?? '');

	onMount(() => {
		topicsStore.start();
		personasStore.start();
		chaptersStore.start();
		postDebateCommentsStore.start();
		return () => {
			topicsStore.stop();
			personasStore.stop();
			chaptersStore.stop();
			postDebateCommentsStore.stop();
		};
	});
</script>

<svelte:head>
	<title>{debate?.topicTitle ?? 'logotope'} — logotope</title>
	<meta
		name="description"
		content={debate ? `${debate.topicTitle}についての多角的な討論。${personaNames}が参加。` : ''}
	/>
	<meta property="og:title" content="{debate?.topicTitle ?? 'logotope'} — logotope" />
	<meta
		property="og:description"
		content={debate ? `${debate.topicTitle}についての多角的な討論。${personaNames}が参加。` : ''}
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
