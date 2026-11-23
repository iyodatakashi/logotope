<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import { phasePath, phaseOrder } from '#lib/models/phase/phase.ts';
	import { PHASE_DEFS } from '#lib/models/phase/phase.constants.ts';
	import { type PhaseSlug } from '#lib/models/phase/phase.types.ts';
	import { currentTopicStore } from '#lib/stores/currentTopic.svelte.ts';

	let { children }: { children: Snippet } = $props();

	const topicId = page.params.topicId as string;

	$effect(() => {
		return currentTopicStore.start(page.params.topicId as string);
	});

	// トピック直下（旧URL）と未到達フェーズへのアクセスは、現在フェーズへ置換リダイレクトする
	// （到達済みフェーズの閲覧では遷移しない）
	$effect(() => {
		if (
			currentTopicStore.topic &&
			(pagePhase === null || phaseOrder(pagePhase) > phaseOrder(currentPhase))
		) {
			goto(phasePath(topicId, currentPhase), { replaceState: true });
		}
	});

	const currentPhase = $derived<PhaseSlug>(currentTopicStore.topic?.phase ?? 'theme');

	// 現在URLのフェーズ（/admin/topics/[id] 直下では null）
	const pagePhase = $derived.by((): PhaseSlug | null => {
		const slug = page.route.id?.split('/').at(-1);
		return PHASE_DEFS.find((phaseDef) => phaseDef.key === slug)?.key ?? null;
	});
</script>

{#if pagePhase === null || phaseOrder(pagePhase) <= phaseOrder(currentPhase)}
	{@render children()}
{/if}
