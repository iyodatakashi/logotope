<script lang="ts">
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte.js';
	import { phaseActions } from '$lib/models/topic/phaseActions.js';
	import { phaseLogicalState } from '$lib/utils/phase.js';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';

	const PHASE = 5;
	const logicalState = $derived.by(() => {
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});

	const personaMap = $derived(
		new Map(currentTopicStore.personasStore.personas.map((p) => [p.id, p]))
	);

	const turns = $derived(
		(currentTopicStore.sessionStore.session?.turns ?? [])
			.slice()
			.sort((a, b) => a.turnIndex - b.turnIndex)
			.map((t) => {
				const persona = t.personaId ? personaMap.get(t.personaId) : null;
				const addressedPersona = t.addressedPersonaId ? personaMap.get(t.addressedPersonaId) : null;
				return {
					id: t.id,
					turnIndex: t.turnIndex,
					speakerType: t.speakerType,
					speakerName: t.speakerName ?? persona?.name ?? 'ファシリテーター',
					// 話者の役割はステークホルダーのカテゴリではなく、ペルソナ個人の具体的な職業を表示する
					speakerRole: persona?.occupation ?? t.speakerRole ?? '',
					content: t.content,
					speechMode: t.speechMode,
					fromQueue: t.fromQueue,
					personaId: t.personaId,
					addressedPersonaName: addressedPersona?.name ?? null,
					engagements: (
						currentTopicStore.engagementsStore.engagementsMap.get(t.turnIndex) ?? []
					).map((e) => ({
						...e,
						name: personaMap.get(e.personaId)?.name ?? e.personaId
					})),
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

	const chapters = $derived(currentTopicStore.sessionStore.session?.chapters ?? null);
	const currentChapterIndex = $derived(
		currentTopicStore.sessionStore.session?.currentChapterIndex ?? null
	);
	const currentChapter = $derived(
		chapters && currentChapterIndex !== null ? chapters[currentChapterIndex] : null
	);
	const completedTurns = $derived(turns.length);
	const totalTurns = $derived(currentTopicStore.sessionStore.session?.totalTurns ?? 0);
</script>

<PhasePanel
	phase={PHASE}
	{logicalState}
	title="フェーズ 5: 討論"
	onGenerate={() => void phaseActions.generate(PHASE)}
	onApprove={() => void phaseActions.approve(PHASE)}
	onRegenerate={() => void phaseActions.regenerate(PHASE)}
	onRetry={() => void phaseActions.retry(PHASE)}
	onStop={() => void phaseActions.stopDebate()}
	onRestart={() => void phaseActions.restartDebate()}
>
	{#snippet progress()}
		{#if logicalState === 'running'}
			{#if currentChapter}
				<p class="chapter-progress">
					第{(currentChapterIndex ?? 0) + 1}章「{currentChapter.title}」
					{#if chapters}（第{(currentChapterIndex ?? 0) + 1}章 / 全{chapters.length}章）{/if}
				</p>
			{:else if totalTurns > 0}
				<p class="chapter-progress">討論中...（ターン {completedTurns} / {totalTurns}）</p>
			{/if}
		{/if}
	{/snippet}
	{#snippet content()}
		{#if chapters}
			<ol class="chapters">
				{#each chapters as chapter}
					<li class:current={chapter.index === (currentChapterIndex ?? 0)}>
						<strong>{chapter.title}</strong>
						<span class="focus">{chapter.focusQuestion}</span>
					</li>
				{/each}
			</ol>
		{/if}

		{#if turns.length > 0}
			<div class="turns">
				{#each turns as turn, i (turn.id)}
					<div class="turn" class:facilitator={turn.speakerType === 'facilitator'}>
						<div class="speaker">
							<strong>{turn.speakerName}</strong>
							{#if turn.speakerRole}
								<span class="role">({turn.speakerRole})</span>
							{/if}
							{#if turn.speechMode}
								<span class="speech-mode">[{turn.speechMode}]</span>
							{/if}
							{#if turn.fromQueue}
								<span class="from-queue">[キュー]</span>
							{/if}
						</div>
						<p class="content">{turn.content}</p>
						{#if turn.addressedPersonaName}
							<p class="nominated">次の指名: {turn.addressedPersonaName}</p>
						{/if}
						{#if turn.engagements.length > 0}
							{@const nextPersonaId = turns[i + 1]?.personaId}
							<div class="engagements">
								{#each turn.engagements as e}
									{@const selected = !!nextPersonaId && e.personaId === nextPersonaId}
									<span class="engagement" data-mode={e.mode} class:selected>
										{e.name}: {e.mode}({e.score}){#if selected}→選択{/if}
									</span>
								{/each}
							</div>
						{/if}
						{#if turn.beliefChangesTriggered.length > 0}
							<ul class="beliefs">
								{#each turn.beliefChangesTriggered as bc}
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
	.focus {
		margin-left: 8px;
		font-weight: normal;
		color: #aaa;
		font-size: 0.85rem;
	}
	.chapters li.current .focus {
		color: #5c8fd6;
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
		color: #fff;
		background: #888;
		padding: 1px 5px;
		border-radius: 3px;
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
	.engagements {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 6px;
	}
	.engagement {
		font-size: 0.72rem;
		padding: 1px 6px;
		border-radius: 3px;
		background: #eee;
		color: #555;
	}
	.engagement[data-mode='full'] {
		background: #e3f2fd;
		color: #1565c0;
	}
	.engagement[data-mode='reaction'] {
		background: #f3e5f5;
		color: #6a1b9a;
	}
	.engagement[data-mode='none'] {
		background: #f5f5f5;
		color: #999;
	}
	.engagement.selected {
		font-weight: 700;
		outline: 1px solid currentColor;
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
</style>
