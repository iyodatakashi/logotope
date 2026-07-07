<script lang="ts">
	import { Checkbox } from '@14ch/svelte-ui';
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath, nextPhase } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import EngagementList from './EngagementList.svelte';

	const PHASE: PhaseSlug = 'debate';
	// 押下直後の楽観的な「実行中」表示用フラグ。討論は running をサーバが書くため
	// callable 往復のあいだ表示が変わらない。その間を埋める表示専用のフラグ。
	// isResetting はやり直し時に旧ターンを即時非表示にする（再開はターンを引き継ぐので消さない）。
	let isStarting = $state(false);
	let isResetting = $state(false);
	// 討論を1章で終了するか最後の章まで続けるかの制御。開始/再開/やり直し時にサーバへ渡す。
	let singleChapterMode = $state(false);

	const generate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.startDebate(singleChapterMode);
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
			await topic.restartDebate(singleChapterMode);
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
			// 討論をやり直すと下流の編集成果物も陳腐化するため破棄する。
			// startDebate を最後に呼ぶことで phase が debate へ戻る（resetEditing の phase 書込より後勝ち）。
			await topic.resetDebate();
			await topic.resetEditing();
			await topic.startDebate(singleChapterMode);
		} finally {
			isStarting = false;
			isResetting = false;
		}
	};

	// 討論を確定して編集フェーズへ前進する。generated のときのみ PhasePanel が表示する。
	const approve = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		await topic.approveDebate();
		const next = nextPhase(PHASE);
		if (next) goto(phasePath(topic.id, next));
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
		new Map(currentTopicStore.personasStore.personas.map((persona) => [persona.id, persona]))
	);

	const turns = $derived(
		currentTopicStore.chaptersStore.turns.map((turn) => {
			const persona = turn.personaId ? personaMap.get(turn.personaId) : null;
			const addressedPersona = turn.targetPersonaId ? personaMap.get(turn.targetPersonaId) : null;
			return {
				id: turn.id,
				speakerType: turn.speakerType,
				speakerName: persona?.name ?? 'ファシリテーター',
				speakerRole: persona?.specificRole ?? persona?.stakeholderRole ?? '',
				content: turn.content,
				speechMode: turn.speechMode,
				engagementScore: turn.engagementScore,
				fromQueue: turn.fromQueue,
				personaId: turn.personaId,
				addressedPersonaName: addressedPersona?.name ?? null,
				engagements: currentTopicStore.engagementsStore.engagementsMap.get(turn.id) ?? [],
				// このターンを聞いて各ペルソナが得た気づき（triggeredByTurnId で紐づく）
				awarenessesTriggered: currentTopicStore.personasStore.personas.flatMap((awarenessPersona) =>
					(awarenessPersona.awarenesses ?? [])
						.filter((awareness) => awareness.triggeredByTurnId === turn.id)
						.map((awareness) => ({
							personaName: awarenessPersona.name,
							content: awareness.content
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
		description: '現在の討論内容と、生成済みの編集がすべて削除され、最初から討論し直します。',
		submitLabel: '最初からやり直す'
	}}
	stopLabel="討論を停止する"
	restartLabel="討論を再開する"
	approveLabel="討論を確定して編集へ"
	onGenerate={generate}
	onRegenerate={regenerate}
	onStop={stop}
	onRestart={restart}
	onApprove={approve}
>
	{#snippet headerControls()}
		<Checkbox bind:value={singleChapterMode}>1章で討論を終了する</Checkbox>
	{/snippet}
	{#snippet progress()}
		{#if logicalState === 'running' && !isResetting}
			{#if currentTopicStore.chaptersStore.currentChapter}
				<p class="generate-debate-page__chapter-progress">
					第{currentTopicStore.chaptersStore.currentChapter.chapterIndex + 1}章「{currentTopicStore
						.chaptersStore.currentChapter.title}」
					{#if currentTopicStore.chaptersStore.chapters.length}（第{currentTopicStore.chaptersStore
							.currentChapter.chapterIndex + 1}章 / 全{currentTopicStore.chaptersStore.chapters
							.length}章）{/if}
				</p>
			{:else if turns.length > 0}
				<p class="generate-debate-page__chapter-progress">討論中...（ターン {turns.length}）</p>
			{/if}
		{/if}
	{/snippet}
	{#snippet content()}
		{#if currentTopicStore.chaptersStore.chapters.length}
			<ol class="generate-debate-page__chapters">
				{#each currentTopicStore.chaptersStore.chapters as chapter (chapter.id)}
					<li
						class:generate-debate-page__chapter--current={chapter ===
							currentTopicStore.chaptersStore.currentChapter}
					>
						<strong>{chapter.title}</strong>
						{#if chapter === currentTopicStore.chaptersStore.currentChapter && chapter.discussionPointStatuses?.length}
							<ul class="generate-debate-page__points">
								{#each chapter.discussionPointStatuses as dp (dp.point)}
									<li class="generate-debate-page__point" data-status={dp.status}>
										<span class="generate-debate-page__status-badge"
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
							<ul class="generate-debate-page__points">
								{#each chapter.discussionPoints as point (point)}
									<li class="generate-debate-page__point">{point}</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}

		{#if !isResetting && turns.length > 0}
			<div class="generate-debate-page__turns">
				{#each turns as turn, i (turn.id)}
					<div
						class="generate-debate-page__turn"
						class:generate-debate-page__turn--facilitator={turn.speakerType === 'facilitator'}
					>
						<div class="generate-debate-page__speaker">
							<strong>{turn.speakerName}</strong>
							{#if turn.speakerRole}
								<span class="generate-debate-page__role">({turn.speakerRole})</span>
							{/if}
							{#if turn.speechMode}
								<span class="generate-debate-page__speech-mode" data-mode={turn.speechMode}>
									{turn.speechMode}{#if turn.engagementScore}({turn.engagementScore}){/if}
								</span>
							{/if}
							{#if turn.fromQueue}
								<span class="generate-debate-page__from-queue">[キュー]</span>
							{/if}
						</div>
						<p class="generate-debate-page__content">{turn.content}</p>
						{#if turn.addressedPersonaName}
							<p class="generate-debate-page__nominated">次の指名: {turn.addressedPersonaName}</p>
						{/if}
						<EngagementList
							engagements={turn.engagements}
							{personaMap}
							selectedPersonaId={turns[i + 1]?.personaId}
						/>
						{#if turn.awarenessesTriggered.length > 0}
							<ul class="generate-debate-page__awarenesses">
								{#each turn.awarenessesTriggered as aw, awIdx (awIdx)}
									<li>💡 {aw.personaName}: {aw.content}</li>
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
	.generate-debate-page__chapter-progress {
		color: #1565c0;
		font-size: 0.95rem;
	}
	.generate-debate-page__chapters {
		margin: 12px 0;
		padding-left: 24px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.generate-debate-page__chapters li {
		color: #888;
		font-size: 0.9rem;
	}
	.generate-debate-page__chapters li.generate-debate-page__chapter--current {
		color: #1565c0;
		font-weight: 600;
	}
	.generate-debate-page__points {
		margin: 4px 0 0 8px;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.generate-debate-page__point {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font-size: 0.78rem;
		font-weight: normal;
		color: #666;
	}
	.generate-debate-page__status-badge {
		flex-shrink: 0;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 1px 4px;
		border-radius: 3px;
		background: #e0e0e0;
		color: #757575;
	}
	.generate-debate-page__point[data-status='introduced'] .generate-debate-page__status-badge {
		background: #fff3e0;
		color: #e65100;
	}
	.generate-debate-page__point[data-status='addressed'] .generate-debate-page__status-badge {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.generate-debate-page__turns {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 8px;
	}
	.generate-debate-page__turn {
		padding: 12px;
		border-left: 4px solid #e0e0e0;
	}
	.generate-debate-page__turn.generate-debate-page__turn--facilitator {
		border-left-color: #1565c0;
		background: #f8f9ff;
	}
	.generate-debate-page__speaker {
		margin-bottom: 4px;
	}
	.generate-debate-page__role {
		color: #757575;
		font-size: 0.875rem;
		margin-left: 4px;
	}
	.generate-debate-page__speech-mode {
		font-size: 0.75rem;
		margin-left: 6px;
		color: #555;
		background: #eee;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.generate-debate-page__speech-mode[data-mode='opinion'] {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.generate-debate-page__speech-mode[data-mode='fact'] {
		background: #e3f2fd;
		color: #1565c0;
	}
	.generate-debate-page__from-queue {
		font-size: 0.75rem;
		margin-left: 4px;
		color: #fff;
		background: #e65100;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.generate-debate-page__content {
		margin: 0;
		line-height: 1.6;
	}
	.generate-debate-page__nominated {
		margin: 4px 0 0;
		font-size: 0.75rem;
		color: #b45309;
		background: #fef3c7;
		padding: 2px 8px;
		border-radius: 3px;
		display: inline-block;
	}
	.generate-debate-page__awarenesses {
		margin-top: 8px;
		font-size: 0.85rem;
		color: #555;
		list-style: none;
		padding: 0;
	}
</style>
