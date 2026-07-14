<script lang="ts">
	import type { Stakeholder } from '$lib/models/stakeholder/stakeholder.types';
	import type { Persona } from '$lib/models/persona/persona.types';
	import StakeholderItem from './StakeholderItem.svelte';
	import PersonaItem from './PersonaItem.svelte';

	// 1行=採用チェック＋ステークホルダー（左）と、対応ペルソナ＋取材状態（右）。
	// 対応ペルソナが無ければ右側は空白（プレースホルダーなし）。状態は持たず採用トグルは親へ委譲する。
	let {
		stakeholder,
		persona
	}: {
		stakeholder: Stakeholder;
		persona: Persona | undefined;
	} = $props();
</script>

<div class="stakeholder-persona-row">
	<div class="stakeholder-persona-row__left">
		<StakeholderItem {stakeholder} />
	</div>

	<div class="stakeholder-persona-row__right">
		{#if persona}
			<PersonaItem {persona} />
		{/if}
	</div>
</div>

<style>
	.stakeholder-persona-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		/* 左右セルを行の高さに揃える（stakeholder カードと persona カードを同じ高さに） */
		align-items: stretch;
	}

	.stakeholder-persona-row__left {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 8px;
		align-items: stretch;
	}

	.stakeholder-persona-row__right {
		display: flex;
		flex-direction: column;
	}
</style>
