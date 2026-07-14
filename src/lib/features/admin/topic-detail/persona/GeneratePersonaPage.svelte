<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { Button, ConfirmDialog, Skeleton } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath } from '$lib/models/phase/phase';
	import type { PhaseLogicalState } from '$lib/models/phase/phase.types';
	import type { Stakeholder } from '$lib/models/stakeholder/stakeholder.types';
	import type { Persona } from '$lib/models/persona/persona.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import StakeholderPersonaRow from './StakeholderPersonaRow.svelte';

	// ステークホルダーに対応するペルソナを安定 id で解決する。
	const matchPersona = (stakeholder: Stakeholder): Persona | undefined =>
		personas.find((persona) => persona.stakeholderId === stakeholder.id);

	// 押下直後の楽観的な「実行中」表示。実状態(running)が反映されたら解除する。
	let starting = $state<null | 'stakeholders' | 'personas' | 'interviews'>(null);

	let regenerateStakeholdersDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();
	let regeneratePersonasDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();
	let regenerateInterviewsDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();

	const topic = $derived(currentTopicStore.topic);
	const stakeholders = $derived(currentTopicStore.stakeholdersStore.stakeholders);
	const personas = $derived(currentTopicStore.personasStore.personas);

	const logicalState = (phase: 'stakeholders' | 'personas' | 'interviews'): PhaseLogicalState => {
		if (starting === phase) return 'running';
		if (!topic) return 'not_started';
		return phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, phase);
	};
	const stakeholdersState = $derived(logicalState('stakeholders'));
	const personasState = $derived(logicalState('personas'));
	const interviewsState = $derived(logicalState('interviews'));

	// 実状態が running に達したら楽観表示を解除する。
	$effect(() => {
		if (!topic) return;
		const actual = phaseLogicalState(
			{ phase: topic.phase, phaseStatus: topic.phaseStatus },
			starting ?? 'stakeholders'
		);
		if (starting && actual === 'running') untrack(() => (starting = null));
	});

	const rows = $derived(
		stakeholders.map((stakeholder) => ({
			stakeholder,
			persona: matchPersona(stakeholder)
		}))
	);
	// 採用集合は採用（チェックON）ステークホルダーの安定 id。
	const selectedStakeholderIds = $derived(
		stakeholders
			.filter((stakeholder) => stakeholder.selected)
			.map((stakeholder) => stakeholder.id)
	);

	const hasStakeholders = $derived(stakeholders.length > 0);
	const hasPersonas = $derived(personas.length > 0);
	const canGeneratePersonas = $derived(hasStakeholders && selectedStakeholderIds.length > 0);
	const hasAnyInterview = $derived(personas.some((persona) => persona.interview != null));

	// --- 操作ハンドラ（オーケストレーション。ドメイン操作は既存 model/store に委譲する） ---

	const runWith = async (phase: NonNullable<typeof starting>, work: () => Promise<void>) => {
		starting = phase;
		try {
			await work();
		} finally {
			starting = null;
		}
	};

	const onGenerateStakeholders = () =>
		runWith('stakeholders', async () => {
			if (!topic) return;
			await topic.generateStakeholders();
		});

	// 再調査: ステークホルダーと下流（ペルソナ・章立て・討論・編集）を破棄してから作り直す。
	const onRegenerateStakeholders = () =>
		runWith('stakeholders', async () => {
			if (!topic) return;
			await topic.resetStakeholders();
			await topic.resetPersonas();
			await topic.resetChapters();
			await topic.resetDebate();
			await topic.resetEditing();
			await topic.generateStakeholders();
		});

	// ペルソナ生成: 採用集合のみを生成対象とする。ステークホルダー承認は phase 前進で暗黙成立する。
	const onGeneratePersonas = () =>
		runWith('personas', async () => {
			if (!topic) return;
			await topic.generatePersonas(selectedStakeholderIds);
		});

	// 再生成: 採用選択に一致させるため下流を破棄してから作り直す（取材以降を破棄）。
	const onRegeneratePersonas = () =>
		runWith('personas', async () => {
			if (!topic) return;
			await topic.resetPersonas();
			await topic.resetChapters();
			await topic.resetDebate();
			await topic.resetEditing();
			await topic.generatePersonas(selectedStakeholderIds);
		});

	// 取材: ペルソナ承認（approved:true 付与＋phase 前進）を畳み込んでから取材を実行する。
	const onRunInterviews = () =>
		runWith('interviews', async () => {
			if (!topic) return;
			await currentTopicStore.personasStore.approvePersonas();
			await currentTopicStore.personasStore.runInterviews(topic.title);
		});

	// 再取材: 取材記録と下流（章立て・討論・編集）を破棄してから全ペルソナを再取材する。
	const onRegenerateInterviews = () =>
		runWith('interviews', async () => {
			if (!topic) return;
			await topic.resetChapters();
			await topic.resetDebate();
			await topic.resetEditing();
			await currentTopicStore.personasStore.runInterviews(topic.title, true);
		});

	// 章立てへ進む: 取材承認（phase 前進）してから章立てフェーズへ遷移する。
	const onAdvanceToChapters = async () => {
		if (!topic) return;
		await topic.approveInterviews();
		goto(phasePath(topic.id, 'chapters'));
	};
</script>

<PhasePanel>
	{#snippet actions()}
		<div class="generate-persona-page__actions">
			<!-- ステークホルダー調査 -->
			{#if stakeholdersState === 'running'}
				<Button variant="filled" loading onclick={() => {}}>調査中…</Button>
			{:else if !hasStakeholders}
				<Button variant="filled" onclick={onGenerateStakeholders}>調査を開始する</Button>
			{:else}
				<Button variant="outlined" onclick={() => regenerateStakeholdersDialog?.open()}>
					ステークホルダーを再調査する
				</Button>
			{/if}

			<!-- ペルソナ生成 -->
			{#if personasState === 'running'}
				<Button variant="filled" loading onclick={() => {}}>ペルソナ生成中…</Button>
			{:else if !hasPersonas}
				<Button variant="filled" disabled={!canGeneratePersonas} onclick={onGeneratePersonas}>
					ペルソナを生成する
				</Button>
			{:else}
				<Button
					variant="outlined"
					disabled={!canGeneratePersonas}
					onclick={() => regeneratePersonasDialog?.open()}
				>
					ペルソナを再生成する
				</Button>
			{/if}

			<!-- ペルソナ取材 -->
			{#if interviewsState === 'running'}
				<Button variant="filled" loading onclick={() => {}}>取材中…</Button>
			{:else if !hasAnyInterview}
				<Button variant="filled" disabled={!hasPersonas} onclick={onRunInterviews}>
					取材を開始する
				</Button>
			{:else}
				{#if interviewsState === 'stopped'}
					<Button variant="filled" disabled={!hasPersonas} onclick={onRunInterviews}>
						取材を再開する
					</Button>
				{/if}
				<Button
					variant="outlined"
					disabled={!hasPersonas}
					onclick={() => regenerateInterviewsDialog?.open()}
				>
					再取材する
				</Button>
			{/if}

			<!-- 章立てへ進む -->
			{#if interviewsState === 'generated'}
				<Button variant="filled" onclick={onAdvanceToChapters}>章立てへ進む</Button>
			{/if}
		</div>

		{#if !canGeneratePersonas && hasStakeholders && !hasPersonas}
			<p class="generate-persona-page__hint">
				ペルソナを生成するには、少なくとも1件のステークホルダーを採用してください。
			</p>
		{/if}
	{/snippet}

	{#snippet content()}
		<div class="generate-persona-page__content">
			{#if stakeholdersState === 'running'}
				<Skeleton
					patterns={[{ type: 'box', width: '100%', height: '96px' }]}
					repeat={5}
					repeatGap="12px"
				/>
			{:else if hasStakeholders}
				<div class="generate-persona-page__rows">
					{#each rows as row (row.stakeholder.id)}
						<StakeholderPersonaRow stakeholder={row.stakeholder} persona={row.persona} />
					{/each}
				</div>
			{/if}
		</div>
	{/snippet}
</PhasePanel>

<ConfirmDialog
	bind:this={regenerateStakeholdersDialog}
	title="ステークホルダーを再調査しますか？"
	description="現在のステークホルダーと、以降のフェーズで生成済みのデータ（ペルソナ・取材・章立て・討論・編集）が削除されます。"
	danger
	submitLabel="再調査する"
	cancelLabel="キャンセル"
	onSubmit={onRegenerateStakeholders}
/>
<ConfirmDialog
	bind:this={regeneratePersonasDialog}
	title="ペルソナを再生成しますか？"
	description="現在のペルソナと、以降のフェーズで生成済みのデータ（取材・章立て・討論・編集）が削除され、現在の採用選択で作り直します。"
	danger
	submitLabel="再生成する"
	cancelLabel="キャンセル"
	onSubmit={onRegeneratePersonas}
/>
<ConfirmDialog
	bind:this={regenerateInterviewsDialog}
	title="取材をやり直しますか？"
	description="現在の取材記録と、以降のフェーズで生成済みのデータ（章立て・討論・編集）が削除されます。"
	danger
	submitLabel="再取材する"
	cancelLabel="キャンセル"
	onSubmit={onRegenerateInterviews}
/>

<style>
	.generate-persona-page__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.generate-persona-page__content {
		max-width: 960px;
		margin: 0 auto;
	}

	.generate-persona-page__hint {
		margin-top: 8px;
		color: var(--svelte-ui-text-subtle-color);
		font-size: var(--svelte-ui-font-size-sm);
	}

	.generate-persona-page__rows {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
</style>
