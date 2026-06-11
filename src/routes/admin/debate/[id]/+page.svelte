<script lang="ts">
	import { goto } from '$app/navigation';
	import { phasePath } from '$lib/utils/phase.js';
	import { getPhasePageContext } from './phase-context.js';

	const ctx = getPhasePageContext();

	// 旧URL（トピック直下）は現在フェーズのURLへ置換リダイレクト
	$effect(() => {
		if (ctx.topic) {
			goto(phasePath(ctx.topicId, ctx.currentPhase), { replaceState: true });
		}
	});
</script>
