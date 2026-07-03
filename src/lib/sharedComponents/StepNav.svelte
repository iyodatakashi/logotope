<script lang="ts">
	import { Tab } from '@14ch/svelte-ui';
	import { phasePath, phaseOrder } from '$lib/models/phase/phase';
	import { PHASE_DEFS } from '$lib/models/phase/phase.constants';
	import { type PhaseSlug } from '$lib/models/phase/phase.types';

	let { topicId, currentPhase }: { topicId: string; currentPhase: PhaseSlug } = $props();

	const tabItems = $derived(
		PHASE_DEFS.map((phaseDefinition) => ({
			label: phaseDefinition.label,
			href: phasePath(topicId, phaseDefinition.key),
			disabled: phaseOrder(phaseDefinition.key) > phaseOrder(currentPhase)
		}))
	);
</script>

<Tab {tabItems} ariaLabel="討論生成フェーズ" />
