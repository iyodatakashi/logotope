<script lang="ts">
	import { Button } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState } from '$lib/models/phase/phase';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import EngagementList from './EngagementList.svelte';
	import FactCheckFindings from './FactCheckFindings.svelte';
	import type { FactCheckFinding } from '$lib/models/factCheck/factCheck.types';

	const PHASE = 5;
	// 押下直後の楽観的な「実行中」表示用フラグ。討論は running をサーバが書くため
	// callable 往復のあいだ表示が変わらない。その間を埋める表示専用のフラグ。
	// isResetting はやり直し時に旧ターンを即時非表示にする（再開はターンを引き継ぐので消さない）。
	let isStarting = $state(false);
	let isResetting = $state(false);

	const generate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.startDebate();
		} finally {
			isStarting = false;
		}
	};
	const stop = () => currentTopicStore.topic?.stopDebate();
	const restart = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.restartDebate();
		} finally {
			isStarting = false;
		}
	};

	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		isResetting = true;
		try {
			await topic.resetDebate();
			await topic.startDebate();
		} finally {
			isStarting = false;
			isResetting = false;
		}
	};

	const logicalState = $derived.by(() => {
		if (isStarting) return 'running';
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});

	// 実状態(running)がトピックに反映されたら楽観フラグを解除し、以降は実状態に委ねる。
	$effect(() => {
		const topic = currentTopicStore.topic;
		if (
			topic &&
			phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE) === 'running'
		) {
			isStarting = false;
			isResetting = false;
		}
	});

	const personaMap = $derived(
		new Map(currentTopicStore.personasStore.personas.map((p) => [p.id, p]))
	);

	// 章ごとの結果から turnId 別に指摘をまとめる（各発言の直下に表示する）
	const findingsByTurn = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, FactCheckFinding[]>();
		for (const result of currentTopicStore.factCheckStore.resultsMap.values()) {
			for (const finding of result.findings) {
				map.set(finding.turnId, [...(map.get(finding.turnId) ?? []), finding]);
			}
		}
		return map;
	});

	const turns = $derived(
		currentTopicStore.chaptersStore.turns.map((t) => {
			const persona = t.personaId ? personaMap.get(t.personaId) : null;
			const addressedPersona = t.targetPersonaId ? personaMap.get(t.targetPersonaId) : null;
			return {
				id: t.id,
				speakerType: t.speakerType,
				speakerName: persona?.name ?? 'ファシリテーター',
				speakerRole: persona?.specificRole ?? persona?.stakeholderRole ?? '',
				content: t.content,
				speechMode: t.speechMode,
				engagementScore: t.engagementScore,
				fromQueue: t.fromQueue,
				personaId: t.personaId,
				addressedPersonaName: addressedPersona?.name ?? null,
				engagements: currentTopicStore.engagementsStore.engagementsMap.get(t.id) ?? [],
				factCheckFindings: findingsByTurn.get(t.id) ?? [],
				beliefChangesTriggered: currentTopicStore.personasStore.personas.flatMap((p) =>
					(p.beliefs ?? [])
						.filter((b) => b.triggeredByTurnId === t.id)
						.map((b) => ({
							personaName: p.name,
							changeType: b.changeType ?? '',
							changeSummary: b.changeSummary ?? ''
						}))
				)
			};
		})
	);
</script>

<PhasePanel
	{logicalState}
	title="フェーズ 5: 討論"
	generateLabel="討論を開始する"
	regenerateLabel="最初からやり直す"
	regenerateConfirm={{
		title: '討論を最初からやり直しますか？',
		description: '現在の討論内容がすべて削除され、最初から討論し直します。',
		submitLabel: '最初からやり直す'
	}}
	stopLabel="討論を停止する"
	restartLabel="討論を再開する"
	onGenerate={generate}
	onRegenerate={regenerate}
	onStop={stop}
	onRestart={restart}
>
	{#snippet progress()}
		{#if logicalState === 'running' && !isResetting}
			{#if currentTopicStore.chaptersStore.currentChapter}
				<p class="chapter-progress">
					第{currentTopicStore.chaptersStore.currentChapter.chapterIndex + 1}章「{currentTopicStore
						.chaptersStore.currentChapter.title}」
					{#if currentTopicStore.chaptersStore.chapters.length}（第{currentTopicStore.chaptersStore
							.currentChapter.chapterIndex + 1}章 / 全{currentTopicStore.chaptersStore.chapters
							.length}章）{/if}
				</p>
			{:else if turns.length > 0}
				<p class="chapter-progress">討論中...（ターン {turns.length}）</p>
			{/if}
		{/if}
	{/snippet}
	{#snippet content()}
		{#if currentTopicStore.chaptersStore.chapters.length}
			<ol class="chapters">
				{#each currentTopicStore.chaptersStore.chapters as chapter (chapter.title)}
					<li class:current={chapter === currentTopicStore.chaptersStore.currentChapter}>
						<strong>{chapter.title}</strong>
						{#if chapter.status === 'completed'}
							{@const fcStatus = currentTopicStore.factCheckStore.resultsMap.get(
								chapter.id
							)?.status}
							{@const fcRun = currentTopicStore.factCheckStore.getRunState(chapter.id)}
							{@const fcRunning = fcRun.pending || (fcStatus === 'running' && !fcRun.error)}
							{@const fcFailed = !!fcRun.error || fcStatus === 'failed'}
							<span class="fact-check-action">
								<Button
									variant="outlined"
									disabled={fcRunning}
									onclick={() => currentTopicStore.factCheckStore.runFactCheck(chapter.id)}
								>
									{fcRunning ? 'ファクトチェック実行中…' : 'ファクトチェックを実行'}
								</Button>
								{#if fcFailed}
									<span class="fc-failed">
										ファクトチェックに失敗しました{fcRun.error ? `（${fcRun.error}）` : ''}
									</span>
								{/if}
							</span>
						{/if}
						{#if chapter === currentTopicStore.chaptersStore.currentChapter && chapter.discussionPointStatuses?.length}
							<ul class="points">
								{#each chapter.discussionPointStatuses as dp (dp.point)}
									<li class="point" data-status={dp.status}>
										<span class="status-badge"
											>{dp.status === 'untouched'
												? '未'
												: dp.status === 'introduced'
													? '着'
													: '済'}</span
										>
										{dp.point}
									</li>
								{/each}
							</ul>
						{:else if chapter.discussionPoints?.length}
							<ul class="points">
								{#each chapter.discussionPoints as point (point)}
									<li class="point">{point}</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}

		{#if !isResetting && turns.length > 0}
			<div class="turns">
				{#each turns as turn, i (turn.id)}
					<div class="turn" class:facilitator={turn.speakerType === 'facilitator'}>
						<div class="speaker">
							<strong>{turn.speakerName}</strong>
							{#if turn.speakerRole}
								<span class="role">({turn.speakerRole})</span>
							{/if}
							{#if turn.speechMode}
								<span class="speech-mode" data-mode={turn.speechMode}>
									{turn.speechMode}{#if turn.engagementScore}({turn.engagementScore}){/if}
								</span>
							{/if}
							{#if turn.fromQueue}
								<span class="from-queue">[キュー]</span>
							{/if}
						</div>
						<p class="content">{turn.content}</p>
						{#if turn.addressedPersonaName}
							<p class="nominated">次の指名: {turn.addressedPersonaName}</p>
						{/if}
						<EngagementList
							engagements={turn.engagements}
							{personaMap}
							selectedPersonaId={turns[i + 1]?.personaId}
						/>
						<FactCheckFindings findings={turn.factCheckFindings} />
						{#if turn.beliefChangesTriggered.length > 0}
							<ul class="beliefs">
								{#each turn.beliefChangesTriggered as bc, bcIdx (bcIdx)}
									<li>🔄 {bc.personaName}: {bc.changeSummary}</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/snippet}
</PhasePanel>

<style>
	.chapter-progress {
		color: #1565c0;
		font-size: 0.95rem;
	}
	.chapters {
		margin: 12px 0;
		padding-left: 24px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.chapters li {
		color: #888;
		font-size: 0.9rem;
	}
	.chapters li.current {
		color: #1565c0;
		font-weight: 600;
	}
	.points {
		margin: 4px 0 0 8px;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.point {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font-size: 0.78rem;
		font-weight: normal;
		color: #666;
	}
	.status-badge {
		flex-shrink: 0;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 1px 4px;
		border-radius: 3px;
		background: #e0e0e0;
		color: #757575;
	}
	.point[data-status='introduced'] .status-badge {
		background: #fff3e0;
		color: #e65100;
	}
	.point[data-status='addressed'] .status-badge {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.turns {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 8px;
	}
	.turn {
		padding: 12px;
		border-left: 4px solid #e0e0e0;
	}
	.turn.facilitator {
		border-left-color: #1565c0;
		background: #f8f9ff;
	}
	.speaker {
		margin-bottom: 4px;
	}
	.role {
		color: #757575;
		font-size: 0.875rem;
		margin-left: 4px;
	}
	.speech-mode {
		font-size: 0.75rem;
		margin-left: 6px;
		color: #555;
		background: #eee;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.speech-mode[data-mode='opinion'] {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.speech-mode[data-mode='fact'] {
		background: #e3f2fd;
		color: #1565c0;
	}
	.from-queue {
		font-size: 0.75rem;
		margin-left: 4px;
		color: #fff;
		background: #e65100;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.content {
		margin: 0;
		line-height: 1.6;
	}
	.nominated {
		margin: 4px 0 0;
		font-size: 0.75rem;
		color: #b45309;
		background: #fef3c7;
		padding: 2px 8px;
		border-radius: 3px;
		display: inline-block;
	}
	.beliefs {
		margin-top: 8px;
		font-size: 0.85rem;
		color: #555;
		list-style: none;
		padding: 0;
	}
	.fact-check-action {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-left: 8px;
	}
	.fc-failed {
		color: #c62828;
		font-size: 0.78rem;
	}
</style>
