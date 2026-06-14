<script lang="ts">
	import { Tab } from '@14ch/svelte-ui';
	import { PHASE_DEFS, phasePath, type Phase } from '$lib/utils/phase.js';

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
