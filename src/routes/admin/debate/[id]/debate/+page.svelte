<script lang="ts">
	import Phase4Debate from '$lib/components/admin/Phase4Debate.svelte';
	import { getPhasePageContext } from '../phase-context.js';

	const ctx = getPhasePageContext();
</script>

<Phase4Debate topicId={ctx.topicId} topicTitle={ctx.topic?.title ?? ''} />
