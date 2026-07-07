<script lang="ts">
	import { Checkbox, Button } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import DiffText from './DiffText.svelte';
	import { computeInlineDiff, type InlineDiffSegment } from './inlineDiff';
	import type { EditedChapterDisplayStatus } from '$lib/models/editedChapter/editedChapter.types';
	import type {
		ArticleElement,
		ElementStatus,
		NarrationPartForFirestore
	} from '$lib/models/editorial/editorial.types';

	const PHASE: PhaseSlug = 'editing';
	// 編集後ターンで原本との差分（削除＝赤取消線 / 追加＝緑）を強調表示するかどうか。
	let showDiff = $state(true);
	// 押下直後の楽観的な「実行中」表示用フラグ。実状態(running)が反映されたら解除する。
	let isStarting = $state(false);

	const start = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.startEditing();
		} finally {
			isStarting = false;
		}
	};

	// やり直し: 未実行へ戻してから再度開始する（旧記事の破棄はサーバの startEditing が担う）。
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.resetEditing();
			await topic.startEditing();
		} finally {
			isStarting = false;
		}
	};

	// 未完成の記事要素を種別ごとに個別再生成する。処理中は当該要素の操作を無効化して重複実行を防ぐ。
	const elementKey = (element: ArticleElement): string =>
		element.kind === 'chapter'
			? `chapter:${element.chapterId}`
			: element.kind === 'impression'
				? `impression:${element.personaId}`
				: element.kind;
	let regeneratingKeys = $state<Record<string, boolean>>({});
	const regenerateElement = async (element: ArticleElement) => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		const key = elementKey(element);
		regeneratingKeys = { ...regeneratingKeys, [key]: true };
		try {
			await topic.regenerateArticleElement(element);
		} finally {
			regeneratingKeys = { ...regeneratingKeys, [key]: false };
		}
	};

	const logicalState = $derived.by(() => {
		if (isStarting) return 'running';
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});

	$effect(() => {
		const topic = currentTopicStore.topic;
		if (
			topic &&
			phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE) === 'running'
		) {
			isStarting = false;
		}
	});

	// 編集が確定（generated / stopped）したかどうか。未完成の明示と再生成ボタンは、
	// 生成が走り終えたこの状態でのみ出す（生成中に全要素を「未完成」と誤表示しないため・Req 3.1, 3.2）。
	const editingSettled = $derived(logicalState === 'generated' || logicalState === 'stopped');

	// 編集開始の大前提ゲート（Req 5.4）。討論フェーズが完了するまで開始操作を出さない。
	const debateCompleted = $derived.by(() => {
		const topic = currentTopicStore.topic;
		if (!topic) return false;
		const debateState = phaseLogicalState(
			{ phase: topic.phase, phaseStatus: topic.phaseStatus },
			'debate'
		);
		return debateState === 'generated' || debateState === 'approved';
	});

	// 記事要素の読み取りモデル: 編集後(final)を優先し、無ければ原本(draft)を暫定表示。どちらも無ければ欠落。
	type ElementView = { status: ElementStatus; content: string; diff: InlineDiffSegment[] | null };
	const narrationView = (part: NarrationPartForFirestore): ElementView => {
		if (part.final != null) {
			return {
				status: 'final',
				content: part.final,
				diff: part.draft != null ? computeInlineDiff(part.draft, part.final) : null
			};
		}
		if (part.draft != null) return { status: 'draft_only', content: part.draft, diff: null };
		return { status: 'missing', content: '', diff: null };
	};

	const introView = $derived(narrationView(currentTopicStore.editorialStore.intro));
	const outroView = $derived(narrationView(currentTopicStore.editorialStore.outro));

	// 導入・締めのラベル（未完成の状態表示用）
	const elementStatusLabel = (status: ElementStatus): string =>
		status === 'final' ? '編集済み' : status === 'draft_only' ? '原本のみ（未編集）' : '生成に失敗';

	const personaMap = $derived(
		new Map(currentTopicStore.personasStore.personas.map((persona) => [persona.id, persona]))
	);

	// 原本ターン id → そのターンを聞いて得た気づき（triggeredByTurnId で紐づく）
	const awarenessesByTurn = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, { personaName: string; content: string }[]>();
		for (const persona of currentTopicStore.personasStore.personas) {
			for (const awareness of persona.awarenesses ?? []) {
				map.set(awareness.triggeredByTurnId, [
					...(map.get(awareness.triggeredByTurnId) ?? []),
					{ personaName: persona.name, content: awareness.content }
				]);
			}
		}
		return map;
	});

	const speakerLabel = (speakerType: string, personaId?: string | null) => {
		const persona = personaId ? personaMap.get(personaId) : null;
		return {
			name: persona?.name ?? 'ファシリテーター',
			role: persona?.specificRole ?? persona?.stakeholderRole ?? ''
		};
	};

	const statusLabel = (status: EditedChapterDisplayStatus): string =>
		status === 'completed' ? '編集済み' : status === 'failed' ? '原本表示（失敗）' : '未編集';

	type DisplayTurn = {
		id: string;
		name: string;
		role: string;
		content: string;
		speechMode?: string;
		diff: InlineDiffSegment[] | null;
		removed: boolean;
		awarenesses: { personaName: string; content: string }[];
	};

	// 原本章順に、章別の編集状態と表示ターンを組み立てる（本体＝body）。
	const displayChapters = $derived.by(() => {
		const store = currentTopicStore.editedChaptersStore;
		return currentTopicStore.chaptersStore.chapters.map((chapter) => {
			const status = store.getDisplayStatus(chapter.id);
			const failureReason =
				status === 'failed' ? (store.getEditedChapter(chapter.id)?.failureReason ?? null) : null;
			// 未完成（編集後の無い）章のうち、原本ターンがある章だけ個別再生成できる。
			const canRegenerate = status !== 'completed' && chapter.turns.length > 0;
			if (status === 'completed') {
				const edited = store.getEditedChapter(chapter.id);
				const orderOf = new Map(chapter.turns.map((turn, i) => [turn.id, i]));
				const contentById = new Map(chapter.turns.map((turn) => [turn.id, turn.content]));
				const usedSourceIds = new Set(
					(edited?.turns ?? []).flatMap((editedTurn) => editedTurn.sourceTurnIds)
				);

				const editedItems = (edited?.turns ?? []).map((editedTurn) => {
					const sourceIds = [...editedTurn.sourceTurnIds].sort(
						(a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0)
					);
					const { name, role } = speakerLabel(editedTurn.speakerType, editedTurn.personaId);
					const sourceText = sourceIds.map((sourceId) => contentById.get(sourceId) ?? '').join('');
					const turn: DisplayTurn = {
						id: editedTurn.id,
						name,
						role,
						content: editedTurn.content,
						speechMode: editedTurn.speechMode,
						diff: computeInlineDiff(sourceText, editedTurn.content),
						removed: false,
						awarenesses: sourceIds.flatMap((sourceId) => awarenessesByTurn.get(sourceId) ?? [])
					};
					return {
						sortIndex: Math.min(...sourceIds.map((sourceId) => orderOf.get(sourceId) ?? 0)),
						turn
					};
				});

				const removedItems = chapter.turns
					.filter((rawTurn) => !usedSourceIds.has(rawTurn.id))
					.map((rawTurn) => {
						const { name, role } = speakerLabel(rawTurn.speakerType, rawTurn.personaId);
						const turn: DisplayTurn = {
							id: rawTurn.id,
							name,
							role,
							content: rawTurn.content,
							speechMode: rawTurn.speechMode,
							diff: null,
							removed: true,
							awarenesses: []
						};
						return { sortIndex: orderOf.get(rawTurn.id) ?? 0, turn };
					});

				const turns = [...editedItems, ...removedItems]
					.sort((a, b) => a.sortIndex - b.sortIndex)
					.map((entry) => entry.turn);
				return {
					id: chapter.id,
					title: chapter.title,
					status,
					failureReason,
					canRegenerate,
					turns
				};
			}
			// フォールバック: 原本ターンをそのまま表示する（差分なし）。
			const turns: DisplayTurn[] = chapter.turns.map((turn) => {
				const { name, role } = speakerLabel(turn.speakerType, turn.personaId);
				return {
					id: turn.id,
					name,
					role,
					content: turn.content,
					speechMode: turn.speechMode,
					diff: null,
					removed: false,
					awarenesses: awarenessesByTurn.get(turn.id) ?? []
				};
			});
			return { id: chapter.id, title: chapter.title, status, failureReason, canRegenerate, turns };
		});
	});

	// 所感（impressions）。承認済みペルソナ単位に、編集後 > 原本 > 欠落 で組み立てる。
	// 未完成（draft_only / missing）は編集確定後のみ表示する（Req 3.1, 3.2, 6.6）。
	type DisplayImpression = {
		personaId: string;
		name: string;
		role: string;
		status: ElementStatus;
		content: string;
		diff: InlineDiffSegment[] | null;
	};
	const displayImpressions = $derived.by((): DisplayImpression[] => {
		const impressions = currentTopicStore.editorialStore.impressions;
		return currentTopicStore.personasStore.personas
			.filter((persona) => persona.approved)
			.map((persona): DisplayImpression => {
				const { name, role } = speakerLabel('persona', persona.id);
				const part = impressions[persona.id] ?? { sortOrder: 0, draft: null, final: null };
				const view = narrationView(part);
				return { personaId: persona.id, name, role, ...view };
			})
			.filter((impression) => impression.status !== 'missing' || editingSettled);
	});
</script>

{#if !debateCompleted}
	<!-- 討論完了前は編集開始操作を出さない（画面側の大前提ゲート・Req 5.4） -->
	<div class="phase6-editing__editing-gate">討論が完了すると編集を開始できます。</div>
{:else}
	<PhasePanel
		{logicalState}
		title="フェーズ 6: 編集"
		generateLabel="編集を開始する"
		regenerateLabel="編集をやり直す"
		regenerateConfirm={{
			title: '編集をやり直しますか？',
			description: '現在の編集記事がすべて削除され、最初から編集し直します。',
			submitLabel: '編集をやり直す'
		}}
		onGenerate={start}
		onRegenerate={regenerate}
	>
		{#snippet headerControls()}
			{#if displayChapters.length}
				<span class="phase6-editing__diff-legend">
					<Checkbox bind:value={showDiff}
						>原本との差分を表示（<del>削除</del> / <ins>追加</ins>）</Checkbox
					>
				</span>
			{/if}
		{/snippet}
		{#snippet content()}
			<!-- 導入（intro）＝記事の先頭 -->
			{#if introView.status !== 'missing' || editingSettled}
				<section class="phase6-editing__narration phase6-editing__narration--intro">
					<div class="phase6-editing__narration-header">
						<h3 class="phase6-editing__narration-label">導入</h3>
						{#if editingSettled && introView.status !== 'final'}
							<span class="phase6-editing__element-status" data-status={introView.status}>
								{elementStatusLabel(introView.status)}
							</span>
							<Button
								variant="outlined"
								onclick={() => regenerateElement({ kind: 'intro' })}
								disabled={regeneratingKeys['intro']}
							>
								{regeneratingKeys['intro'] ? '再生成中...' : '再生成'}
							</Button>
						{/if}
					</div>
					{#if introView.status !== 'missing'}
						{#if showDiff && introView.diff}
							<p class="phase6-editing__narration-body"><DiffText segments={introView.diff} /></p>
						{:else}
							<p class="phase6-editing__narration-body">{introView.content}</p>
						{/if}
					{/if}
				</section>
			{/if}

			<!-- 本体（body＝章） -->
			{#if displayChapters.length}
				<div class="phase6-editing__chapters">
					{#each displayChapters as chapter (chapter.id)}
						<section class="phase6-editing__chapter">
							<header class="phase6-editing__chapter-header">
								<div class="phase6-editing__chapter-title">{chapter.title}</div>
								<span class="phase6-editing__chapter-status" data-status={chapter.status}>
									{statusLabel(chapter.status)}
								</span>
								{#if chapter.failureReason}
									<span class="phase6-editing__failure-reason"
										>検証不合格: {chapter.failureReason}</span
									>
								{/if}
								{#if editingSettled && chapter.canRegenerate}
									<Button
										variant="outlined"
										onclick={() => regenerateElement({ kind: 'chapter', chapterId: chapter.id })}
										disabled={regeneratingKeys[`chapter:${chapter.id}`]}
									>
										{regeneratingKeys[`chapter:${chapter.id}`] ? '再生成中...' : '再生成'}
									</Button>
								{/if}
							</header>
							<div class="phase6-editing__turns">
								{#each chapter.turns as turn (turn.id)}
									{#if turn.removed}
										{#if showDiff}
											<div
												class="phase6-editing__turn phase6-editing__turn--removed"
												class:phase6-editing__turn--facilitator={turn.name === 'ファシリテーター'}
											>
												<div class="phase6-editing__speaker">
													<div class="phase6-editing__speaker-name">{turn.name}</div>
													{#if turn.role}<span class="phase6-editing__role">({turn.role})</span
														>{/if}
													<span class="phase6-editing__removed-label">発言ごと削除</span>
												</div>
												<p class="phase6-editing__content"><del>{turn.content}</del></p>
											</div>
										{/if}
									{:else}
										<div
											class="phase6-editing__turn"
											class:phase6-editing__turn--facilitator={turn.name === 'ファシリテーター'}
										>
											<div class="phase6-editing__speaker">
												<div class="phase6-editing__speaker-name">{turn.name}</div>
												{#if turn.role}<span class="phase6-editing__role">({turn.role})</span>{/if}
												{#if turn.speechMode}
													<span class="phase6-editing__speech-mode" data-mode={turn.speechMode}
														>{turn.speechMode}</span
													>
												{/if}
											</div>
											{#if showDiff && turn.diff}
												<p class="phase6-editing__content"><DiffText segments={turn.diff} /></p>
											{:else}
												<p class="phase6-editing__content">{turn.content}</p>
											{/if}
											{#if turn.awarenesses.length > 0}
												<ul class="phase6-editing__awarenesses">
													{#each turn.awarenesses as awareness, i (i)}
														<li>💡 {awareness.personaName}: {awareness.content}</li>
													{/each}
												</ul>
											{/if}
										</div>
									{/if}
								{/each}
							</div>
						</section>
					{/each}
				</div>
			{/if}

			<!-- 締め（outro）＝本体の後 -->
			{#if outroView.status !== 'missing' || editingSettled}
				<section class="phase6-editing__narration phase6-editing__narration--outro">
					<div class="phase6-editing__narration-header">
						<h3 class="phase6-editing__narration-label">締め</h3>
						{#if editingSettled && outroView.status !== 'final'}
							<span class="phase6-editing__element-status" data-status={outroView.status}>
								{elementStatusLabel(outroView.status)}
							</span>
							<Button
								variant="outlined"
								onclick={() => regenerateElement({ kind: 'outro' })}
								disabled={regeneratingKeys['outro']}
							>
								{regeneratingKeys['outro'] ? '再生成中...' : '再生成'}
							</Button>
						{/if}
					</div>
					{#if outroView.status !== 'missing'}
						{#if showDiff && outroView.diff}
							<p class="phase6-editing__narration-body"><DiffText segments={outroView.diff} /></p>
						{:else}
							<p class="phase6-editing__narration-body">{outroView.content}</p>
						{/if}
					{/if}
				</section>
			{/if}

			<!-- 所感（impressions）＝締めの後。参加者ごとの締めの所感。 -->
			{#if displayImpressions.length}
				<section class="phase6-editing__impressions">
					<h3 class="phase6-editing__impressions-label">所感</h3>
					<div class="phase6-editing__impressions-list">
						{#each displayImpressions as impression (impression.personaId)}
							<div class="phase6-editing__impression">
								<div class="phase6-editing__speaker">
									<div class="phase6-editing__speaker-name">{impression.name}</div>
									{#if impression.role}<span class="phase6-editing__role">({impression.role})</span
										>{/if}
									{#if editingSettled && impression.status !== 'final'}
										<span class="phase6-editing__element-status" data-status={impression.status}>
											{elementStatusLabel(impression.status)}
										</span>
									{/if}
								</div>
								{#if impression.status !== 'missing'}
									{#if showDiff && impression.diff}
										<p class="phase6-editing__content"><DiffText segments={impression.diff} /></p>
									{:else}
										<p class="phase6-editing__content">{impression.content}</p>
									{/if}
								{/if}
								{#if editingSettled && impression.status !== 'final'}
									<div class="phase6-editing__impression-regenerate">
										<Button
											variant="outlined"
											onclick={() =>
												regenerateElement({ kind: 'impression', personaId: impression.personaId })}
											disabled={regeneratingKeys[`impression:${impression.personaId}`]}
										>
											{regeneratingKeys[`impression:${impression.personaId}`]
												? '再生成中...'
												: '再生成'}
										</Button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</section>
			{/if}
		{/snippet}
	</PhasePanel>
{/if}

<style>
	.phase6-editing__editing-gate {
		padding: 24px;
		color: #757575;
		font-size: 0.95rem;
	}
	.phase6-editing__narration {
		padding: 16px;
		margin-bottom: 24px;
		border-left: 4px solid #7b1fa2;
		background: #faf5fd;
		border-radius: 3px;
	}
	.phase6-editing__narration--outro {
		margin-top: 24px;
		margin-bottom: 0;
	}
	.phase6-editing__narration-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}
	.phase6-editing__narration-label {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 700;
		color: #7b1fa2;
	}
	.phase6-editing__narration-body {
		margin: 0;
		line-height: 1.7;
		white-space: pre-wrap;
	}
	.phase6-editing__element-status {
		font-size: 0.75rem;
		padding: 1px 6px;
		border-radius: 3px;
		background: #ffebee;
		color: #c62828;
	}
	.phase6-editing__element-status[data-status='draft_only'] {
		background: #fff8e1;
		color: #f57f17;
	}
	.phase6-editing__diff-legend ins {
		background: #e6ffed;
		color: #22863a;
		text-decoration: none;
		padding: 0 2px;
	}
	.phase6-editing__diff-legend del {
		background: #ffeef0;
		color: #b31d28;
		padding: 0 2px;
	}
	.phase6-editing__chapters {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.phase6-editing__chapter-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}
	.phase6-editing__chapter-title {
		font-size: 1.5rem;
		font-weight: bold;
	}
	.phase6-editing__chapter-status {
		font-size: 0.75rem;
		padding: 1px 6px;
		border-radius: 3px;
		background: #eee;
		color: #757575;
	}
	.phase6-editing__chapter-status[data-status='completed'] {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.phase6-editing__chapter-status[data-status='failed'] {
		background: #ffebee;
		color: #c62828;
	}
	.phase6-editing__failure-reason {
		font-size: 0.78rem;
		color: #c62828;
	}
	.phase6-editing__turns {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.phase6-editing__turn {
		padding: 12px;
		border-left: 4px solid #e0e0e0;
	}
	.phase6-editing__turn.phase6-editing__turn--facilitator {
		border-left-color: #1565c0;
		background: #f8f9ff;
	}
	.phase6-editing__turn.phase6-editing__turn--removed {
		border-left-color: #e57373;
		background: #fff5f5;
	}
	.phase6-editing__turn.phase6-editing__turn--removed .phase6-editing__content del {
		color: #b31d28;
		text-decoration: line-through;
	}
	.phase6-editing__removed-label {
		font-size: 0.72rem;
		margin-left: 6px;
		color: #fff;
		background: #c62828;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.phase6-editing__speaker {
		margin-bottom: 4px;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.phase6-editing__speaker-name {
		font-weight: bold;
	}
	.phase6-editing__role {
		color: #757575;
		font-size: 0.875rem;
	}
	.phase6-editing__speech-mode {
		font-size: 0.75rem;
		color: #555;
		background: #eee;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.phase6-editing__content {
		margin: 0;
		line-height: 1.6;
	}
	.phase6-editing__awarenesses {
		margin-top: 8px;
		font-size: 0.85rem;
		color: var(--svelte-ui-text-subtle-color);
		list-style: none;
		padding: 0;
	}
	.phase6-editing__impressions {
		margin-top: 24px;
		padding: 16px;
		border-left: 4px solid #00838f;
		background: #f0fafb;
		border-radius: 3px;
	}
	.phase6-editing__impressions-label {
		margin: 0 0 12px;
		font-size: 0.8rem;
		font-weight: 700;
		color: #00838f;
	}
	.phase6-editing__impressions-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.phase6-editing__impression {
		padding: 12px;
		border-left: 4px solid #e0e0e0;
		background: #fff;
	}
	.phase6-editing__impression-regenerate {
		margin-top: 8px;
	}
</style>
