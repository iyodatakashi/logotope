<script lang="ts">
	import { Tab } from '@14ch/svelte-ui';
	import { phasePath } from '$lib/models/phase/phase';
	import { PHASE_DEFS } from '$lib/models/phase/phase.constants';
	import { type Phase } from '$lib/models/phase/phase.types';

	let { topicId, currentPhase }: { topicId: string; currentPhase: Phase } = $props();

	const tabItems = $derived(
		PHASE_DEFS.map((phaseDefinition) => ({
			label: phaseDefinition.label,
			href: phasePath(topicId, phaseDefinition.phase),
			disabled: phaseDefinition.phase > currentPhase
		}))
	);
</script>

<Tab {tabItems} ariaLabel="討論生成フェーズ" />
