<script lang="ts">
	import Phase1Stakeholders from '$lib/components/admin/Phase1Stakeholders.svelte';
	import PhaseResetPanel from '$lib/components/admin/PhaseResetPanel.svelte';
	import { getPhasePageContext } from '../phase-context.js';

	const ctx = getPhasePageContext();
	const isView = $derived(ctx.pageModeFor(1) === 'view');
</script>

<Phase1Stakeholders topicId={ctx.topicId} topicTitle={ctx.topic?.title ?? ''} readonly={isView} />

{#if isView}
	<PhaseResetPanel
		phase={1}
		topicId={ctx.topicId}
		discardSummary={[
			'生成済みのペルソナ（全件）',
			'ペルソナの取材記録と初期信念',
			'討論セッション（全ターン・章構成）'
		]}
		onReset={ctx.topicStore.resetToPhase1}
	/>
{/if}
