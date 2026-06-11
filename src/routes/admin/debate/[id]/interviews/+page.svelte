<script lang="ts">
	import Phase3Interviews from '$lib/components/admin/Phase3Interviews.svelte';
	import PhaseResetPanel from '$lib/components/admin/PhaseResetPanel.svelte';
	import { getPhasePageContext } from '../phase-context.js';

	const ctx = getPhasePageContext();
	const isView = $derived(ctx.pageModeFor(3) === 'view');
</script>

<Phase3Interviews topicId={ctx.topicId} topicTitle={ctx.topic?.title ?? ''} readonly={isView} />

{#if isView}
	<PhaseResetPanel
		phase={3}
		topicId={ctx.topicId}
		discardSummary={['討論セッション（全ターン・章構成・討論後コメント）']}
		onReset={ctx.topicStore.resetToPhase3}
	/>
{/if}
