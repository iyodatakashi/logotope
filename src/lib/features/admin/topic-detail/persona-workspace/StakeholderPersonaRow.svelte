<script lang="ts">
	import { Checkbox } from '@14ch/svelte-ui';
	import type { Stakeholder } from '$lib/models/stakeholder/stakeholder.types';
	import type { Persona } from '$lib/models/persona/persona.types';
	import StakeholderItem from '../stakeholders/StakeholderItem.svelte';
	import PersonaItem from '../personas/PersonaItem.svelte';
	import InterviewItem from '../interview/InterviewItem.svelte';

	// 1行=採用チェック＋ステークホルダー（左）と、対応ペルソナ＋取材状態（右）。
	// 対応ペルソナが無ければ右側は空白（プレースホルダーなし）。状態は持たず採用トグルは親へ委譲する。
	let {
		stakeholder,
		persona,
		checked,
		onToggle
	}: {
		stakeholder: Stakeholder;
		persona: Persona | undefined;
		checked: boolean;
		onToggle: (checked: boolean) => void;
	} = $props();
</script>

<div class="stakeholder-persona-row">
	<div class="stakeholder-persona-row__left">
		<div class="stakeholder-persona-row__check">
			<Checkbox value={checked} onchange={onToggle} ariaLabel="このステークホルダーを採用する" />
		</div>
		<ul class="stakeholder-persona-row__cell">
			<StakeholderItem {stakeholder} />
		</ul>
	</div>

	<div class="stakeholder-persona-row__right">
		{#if persona}
			<ul class="stakeholder-persona-row__cell">
				<PersonaItem {persona} />
				<InterviewItem {persona} />
			</ul>
		{/if}
	</div>
</div>

<style>
	.stakeholder-persona-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		align-items: start;
	}

	.stakeholder-persona-row__left {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 8px;
		align-items: start;
	}

	.stakeholder-persona-row__check {
		padding-top: 16px;
	}

	.stakeholder-persona-row__cell {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
</style>
