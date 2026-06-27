<script lang="ts">
	import { IconButton } from '@14ch/svelte-ui';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import { phasePath } from '$lib/models/phase/phase';
	import { PHASE_DEFS } from '$lib/models/phase/phase.constants';
	import { type Phase } from '$lib/models/phase/phase.types';
	import StepNav from '$lib/sharedComponents/StepNav.svelte';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';

	let { children }: { children: Snippet } = $props();

	const topicId = page.params.topicId as string;

	$effect(() => {
		return currentTopicStore.start(page.params.topicId as string);
	});

	const currentPhase = $derived<Phase>(currentTopicStore.topic?.phase ?? 1);

	// 現在URLのフェーズ（/admin/topics/[id] 直下のリダイレクトページでは null）
	const pagePhase = $derived.by(() => {
		const slug = page.route.id?.split('/').at(-1);
		return PHASE_DEFS.find((d) => d.slug === slug)?.phase ?? null;
	});

	// 未到達フェーズへのアクセスのみ現在フェーズへリダイレクト（到達済みフェーズの閲覧では遷移しない）
	$effect(() => {
		if (currentTopicStore.topic && pagePhase !== null && pagePhase > currentPhase) {
			goto(phasePath(topicId, currentPhase), { replaceState: true });
		}
	});
</script>

<div class="topic-detail-layout">
	<div class="topic-detail-layout__header">
		<div class="topic-detail-layout__title-row">
			<IconButton ariaLabel="戻る" size={40} onclick={() => goto('/admin/topics')}
				>arrow_back</IconButton
			>
			{#if currentTopicStore.topic}
				<h2>{currentTopicStore.topic.title}</h2>
			{/if}
		</div>
		<div class="topic-detail-layout__step-navi">
			<StepNav {topicId} {currentPhase} />
		</div>
	</div>

	<div class="topic-detail-layout__body">
		{#if pagePhase === null || pagePhase <= currentPhase}
			{@render children()}
		{/if}
	</div>
</div>

<style>
	.topic-detail-layout {
		display: grid;
		grid-template-rows: auto 1fr;
		height: 100%;
		overflow: hidden;
		background-color: var(--white);
	}

	.topic-detail-layout__header {
		border-bottom: solid 1px var(--svelte-ui-border-color);

		.topic-detail-layout__title-row {
			display: flex;
			align-items: center;
			padding: 12px 16px;

			h2 {
				font-size: 1.5rem;
				font-weight: bold;
			}
		}

		.topic-detail-layout__step-navi {
			padding: 0 12px;
		}
	}

	.topic-detail-layout__body {
		background: var(--base-50);
		overflow: hidden;
	}
</style>
