<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button, ConfirmDialog, Skeleton } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath } from '$lib/models/phase/phase';
	import type { PhaseLogicalState } from '$lib/models/phase/phase.types';
	import type { Stakeholder } from '$lib/models/stakeholder/stakeholder.types';
	import type { Persona } from '$lib/models/persona/persona.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import StakeholderPersonaRow from './StakeholderPersonaRow.svelte';

	const topic = $derived(currentTopicStore.topic);
	const stakeholders = $derived(currentTopicStore.stakeholdersStore.stakeholders);
	const personas = $derived(currentTopicStore.personasStore.personas);

	// ステークホルダーに対応するペルソナを安定 id で解決する（対応関係の表示用）。
	const matchPersona = (stakeholder: Stakeholder): Persona | undefined =>
		personas.find((persona) => persona.stakeholderId === stakeholder.id);
	const rows = $derived(
		stakeholders.map((stakeholder) => ({ stakeholder, persona: matchPersona(stakeholder) }))
	);

	let regenerateDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();

	// 押下直後の楽観的な「実行中」表示。実状態（running）が反映されるまでの体感の穴を埋める。
	let starting = $state(false);

	// この画面の対象フェーズは personas 一本。一気通貫全体の状態をこの1軸で表す。
	const personasState = $derived.by((): PhaseLogicalState => {
		if (starting) return 'running';
		if (!topic) return 'not_started';
		return phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, 'personas');
	});

	const hasStakeholders = $derived(stakeholders.length > 0);
	const isRunning = $derived(personasState === 'running');
	// 採用ゲート: 採用（selected）ペルソナが1件以上あることが次フェーズ前進の前提（本仕様が所有）。
	const hasSelectedPersona = $derived(personas.some((persona) => persona.selected));
	// 生成を一度でも実行した後の状態（完了・停止・前進済み）は「ペルソナを再生成する」を出す。
	// 前進済み（approved・見返し中）も生成完了と同様に扱う。未実行（not_started）だけが「生成する」。
	const isGenerated = $derived(
		personasState === 'generated' || personasState === 'stopped' || personasState === 'approved'
	);
	// 次フェーズへ前進できる条件: 生成完了（generated）か前進済み（approved）で、採用が1件以上。
	// stopped（失敗）や running・not_started では前進不可。
	const canAdvance = $derived(
		(personasState === 'generated' || personasState === 'approved') && hasSelectedPersona
	);

	// --- 操作ハンドラ（オーケストレーション。ドメイン操作は model/store に委譲する） ---

	const runExec = async (work: () => Promise<void>) => {
		starting = true;
		try {
			await work();
		} finally {
			starting = false;
		}
	};

	// 実行: ステークホルダー生成→ペルソナ生成→全ペルソナ取材をサーバ側で一気通貫に起動する。
	const onExecute = () =>
		runExec(async () => {
			if (!topic) return;
			await topic.startPersonaGeneration();
		});

	// ペルソナを再生成: 承諾時のみ、下流（章立て・討論・編集）まで破棄してから一気通貫を最初から実行する。
	const onRegenerate = () =>
		runExec(async () => {
			if (!topic) return;
			await topic.resetStakeholders();
			await topic.resetPersonas();
			await topic.resetChapters();
			await topic.resetDebate();
			await topic.resetEditing();
			await topic.startPersonaGeneration();
		});

	const handleBackClick = () => {
		if (!topic) return;
		goto(phasePath(topic.id, 'fact-research'));
	};

	// 次フェーズ（chapters）へ進む。採用ペルソナが1件以上あるときのみ許可する（採用ゲート・R4.10）。
	// personas フェーズにいるときだけ前進を確定し、既に先へ進んでいる（approved・見返し中）なら遷移のみ行う
	// （advancePhase を再実行して chapters を not_started へ巻き戻さないため）。
	const handleForwardClick = async () => {
		if (!topic || !hasSelectedPersona) return;
		if (topic.phase === 'personas') {
			await topic.advancePastPersonas();
		}
		goto(phasePath(topic.id, 'chapters'));
	};
</script>

<PhasePanel>
	{#snippet actions()}
		<div class="generate-persona-page__actions">
			<Button variant="outlined" icon="arrow_back" rounded onclick={handleBackClick}>
				前に戻る
			</Button>

			{#if isRunning}
				<Button variant="ghost" rounded loading onclick={() => {}}>ペルソナを生成する</Button>
			{:else if isGenerated}
				<Button variant="ghost" rounded icon="cached" onclick={() => regenerateDialog?.open()}>
					ペルソナを再生成する
				</Button>
			{:else}
				<Button variant="filled" rounded icon="cached" onclick={onExecute}
					>ペルソナを生成する</Button
				>
			{/if}

			<Button
				variant="filled"
				icon="arrow_forward"
				iconPosition="right"
				rounded
				disabled={!canAdvance}
				onclick={handleForwardClick}
			>
				次に進む
			</Button>
		</div>
	{/snippet}

	{#snippet content()}
		<div class="generate-persona-page__content">
			<div class="generate-persona-page__rows-header">
				<div class="generate-persona-page__rows-header__column">ステークホルダー</div>
				<div class="generate-persona-page__rows-header__column">ペルソナ</div>
			</div>
			{#if isRunning && !hasStakeholders}
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
	bind:this={regenerateDialog}
	title="ペルソナを再生成しますか？"
	description="現在のペルソナが作り直され、以降のフェーズで生成済みのデータが削除されます。"
	danger
	submitLabel="再生成する"
	cancelLabel="キャンセル"
	onSubmit={onRegenerate}
/>

<style>
	.generate-persona-page__actions {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}

	.generate-persona-page__content {
		max-width: 960px;
		margin: 0 auto;
	}

	.generate-persona-page__rows-header {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 32px;
		margin-bottom: 16px;

		.generate-persona-page__rows-header__column {
			padding: 8px 4px 8px 16px;
			background: var(--base-50-transparent);
			font-weight: bold;
		}
	}

	.generate-persona-page__rows {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
</style>
