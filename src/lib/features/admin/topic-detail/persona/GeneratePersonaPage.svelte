<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button, ConfirmDialog, Skeleton } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath } from '$lib/models/phase/phase';
	import type { PhaseLogicalState } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import PersonaItem from './PersonaItem.svelte';

	const topic = $derived(currentTopicStore.topic);
	const personas = $derived(currentTopicStore.personasStore.personas);

	let regenerateDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();

	// 押下直後の楽観的な「実行中」表示。実状態（running）が反映されるまでの体感の穴を埋める。
	let starting = $state(false);
	// 「次に進む」押下中の loading・多重押下抑止と、前進失敗時のエラー表示。
	let isApproving = $state(false);
	let approveError = $state('');
	// 再生成の表示専用フラグ。押下直後に旧ペルソナを即時に隠す（実削除はサーバが権威的に行う）。
	// 解除は呼び出し完了ではなく実同期に連動させる（下記 $effect）。往復後の一瞬の旧データ再表示を防ぐ。
	let isRegenerating = $state(false);

	// この画面の対象フェーズは personas 一本。一気通貫全体の状態をこの1軸で表す。
	const personasState = $derived.by((): PhaseLogicalState => {
		if (starting) return 'running';
		if (!topic) return 'not_started';
		return phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, 'personas');
	});

	const hasPersonas = $derived(personas.length > 0);
	const isRunning = $derived(personasState === 'running');
	// 押下直後は旧ペルソナを隠してスケルトンを出す。実削除後も対象フェーズ running なら空スケルトンを継続。
	const showSkeleton = $derived(isRegenerating || (isRunning && !hasPersonas));

	// 再生成フラグの解除は実同期に連動: サーバが対象フェーズ（personas）を running/stopped に確定し（下流の
	// 完了表示が消え）、かつ旧ペルソナが実削除された（!hasPersonas）ときに解除する。呼び出し完了（finally）では
	// 解除しない。generated 起点の再生成では実状態がまだ generated のまま（running 未反映）なので、この条件は
	// 旧データ表示のまま保たれ、往復後の一瞬の旧データ再表示を防ぐ。
	$effect(() => {
		if (!isRegenerating || !topic) return;
		const real = phaseLogicalState(
			{ phase: topic.phase, phaseStatus: topic.phaseStatus },
			'personas'
		);
		if ((real === 'running' || real === 'stopped') && !hasPersonas) {
			isRegenerating = false;
		}
	});
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

	// ペルソナを再生成: サーバ権威の単一操作を1回呼ぶだけ（対象フェーズ確定→自層＋下流破棄→投入をサーバが所有）。
	// 押下直後に isRegenerating で旧ペルソナを即時に隠す（実削除の同期反映を待たない）。対象フェーズへ到達しない
	// 失敗（手順1前）では固着を防ぐため即時に解除する。
	const onRegenerate = () => {
		isRegenerating = true;
		return runExec(async () => {
			if (!topic) return;
			await topic.startPersonaGeneration();
		}).catch((err) => {
			isRegenerating = false;
			throw err;
		});
	};

	const handleBackClick = () => {
		if (!topic) return;
		goto(phasePath(topic.id, 'fact-research'));
	};

	// 次フェーズ（chapters）へ進む。採用ペルソナが1件以上あるときのみ許可する（採用ゲート・R4.10）。
	// personas フェーズにいるときだけ前進を確定し、既に先へ進んでいる（approved・見返し中）なら遷移のみ行う
	// （advancePhase を再実行して chapters を not_started へ巻き戻さないため）。
	const handleForwardClick = async () => {
		if (!topic || !hasSelectedPersona) return;
		isApproving = true;
		approveError = '';
		try {
			if (topic.phase === 'personas') {
				await topic.advancePastPersonas();
			}
			goto(phasePath(topic.id, 'chapters'));
		} catch {
			approveError = 'ペルソナの確定に失敗しました。時間をおいて再試行してください。';
		} finally {
			isApproving = false;
		}
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
				<Button
					variant="filled"
					rounded
					icon="cached"
					color="var(--danger-color)"
					onclick={() => regenerateDialog?.open()}
				>
					ペルソナを再生成する
				</Button>
			{:else}
				<Button variant="filled" rounded icon="cached" onclick={onExecute}>
					ペルソナを生成する
				</Button>
			{/if}

			<div class="generate-persona-page__forward">
				<Button
					variant="filled"
					icon="arrow_forward"
					iconPosition="right"
					rounded
					loading={isApproving}
					disabled={!canAdvance}
					onclick={handleForwardClick}
				>
					次に進む
				</Button>
				{#if approveError}
					<p class="generate-persona-page__error" role="alert">{approveError}</p>
				{/if}
			</div>
		</div>
	{/snippet}

	{#snippet content()}
		<div class="generate-persona-page__content">
			{#if showSkeleton}
				<Skeleton
					patterns={[{ type: 'box', width: '100%', height: '96px' }]}
					repeat={5}
					repeatGap="12px"
				/>
			{:else if hasPersonas}
				<div class="generate-persona-page__rows">
					{#each personas as persona (persona.id)}
						<PersonaItem {persona} />
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

	.generate-persona-page__forward {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.generate-persona-page__error {
		color: var(--svelte-ui-error-color);
		font-size: var(--svelte-ui-font-size-sm);
	}

	.generate-persona-page__content {
		max-width: 960px;
		margin: 0 auto;
	}

	.generate-persona-page__rows {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
</style>
