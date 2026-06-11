<script lang="ts">
	import Phase2Personas from '$lib/components/admin/Phase2Personas.svelte';
	import PhaseResetPanel from '$lib/components/admin/PhaseResetPanel.svelte';
	import { getPhasePageContext } from '../phase-context.js';

	const ctx = getPhasePageContext();
	const isView = $derived(ctx.pageModeFor(2) === 'view');
</script>

<Phase2Personas topicId={ctx.topicId} topicTitle={ctx.topic?.title ?? ''} readonly={isView} />

{#if isView}
	<PhaseResetPanel
		phase={2}
		topicId={ctx.topicId}
		discardSummary={['ペルソナの取材記録と初期信念', '討論セッション（全ターン・章構成）']}
		onReset={ctx.topicStore.resetToPhase2}
	/>
{/if}
