<script lang="ts">
	import { Checkbox } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import DiffText from './DiffText.svelte';
	import { computeInlineDiff, type InlineDiffSegment } from './inlineDiff';
	import type { EditedChapterDisplayStatus } from '$lib/models/editedChapter/editedChapter.types';

	const PHASE: PhaseSlug = 'editing';
	// 編集後ターンで原本との差分（削除＝赤取消線 / 追加＝緑）を強調表示するかどうか。
	// 既定は ON にし、「何が変わったか」を開いた直後に把握できるようにする。
	let showDiff = $state(true);
	// 押下直後の楽観的な「実行中」表示用フラグ。編集は running をサーバが書くため、
	// callable 往復のあいだ表示を埋める表示専用のフラグ。実状態(running)が反映されたら解除する。
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

	// やり直し: 未実行へ戻してから再度開始する（旧成果物の破棄はサーバの startEditing が担う）。
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

	// 討論全体のイントロ（冒頭）・クロージング（末尾）。未生成側は null で、その領域は表示しない。
	const intro = $derived(currentTopicStore.editedIntroClosingStore.intro);
	const closing = $derived(currentTopicStore.editedIntroClosingStore.closing);

	// 編集開始の大前提ゲート（Req 5.4）。討論フェーズが完了（generated 到達 or 次段へ前進）するまでは
	// 開始操作を出さない。サーバ側ゲート（startEditing）と二重化する。
	const debateCompleted = $derived.by(() => {
		const topic = currentTopicStore.topic;
		if (!topic) return false;
		const debateState = phaseLogicalState(
			{ phase: topic.phase, phaseStatus: topic.phaseStatus },
			'debate'
		);
		return debateState === 'generated' || debateState === 'approved';
	});

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

	// 原本章順に、章別の編集状態と表示ターンを組み立てる。
	// 完了章は編集後ターン（由来注釈を結合）を、失敗・未生成章は原本ターンを表示する（章別フォールバック）。
	type DisplayTurn = {
		id: string;
		name: string;
		role: string;
		content: string;
		speechMode?: string;
		// 原本→編集後のインライン差分。完了章の編集後ターンのみ持つ（原本フォールバックは null）。
		diff: InlineDiffSegment[] | null;
		// 編集で発言ごとカットされた原本ターン（差分表示時のみ取消線で見せる）。
		removed: boolean;
		awarenesses: { personaName: string; content: string }[];
	};

	const displayChapters = $derived.by(() => {
		const store = currentTopicStore.editedChaptersStore;
		return currentTopicStore.chaptersStore.chapters.map((chapter) => {
			const status = store.getDisplayStatus(chapter.id);
			// 失敗章は検証不合格理由を添えて原因把握できるようにする（Req 6.4）。
			const failureReason =
				status === 'failed' ? (store.getEditedChapter(chapter.id)?.failureReason ?? null) : null;
			if (status === 'completed') {
				const edited = store.getEditedChapter(chapter.id);
				// 原本ターンの並び順で由来注釈の和集合を取るためのインデックス。
				const orderOf = new Map(chapter.turns.map((turn, i) => [turn.id, i]));
				const contentById = new Map(chapter.turns.map((turn) => [turn.id, turn.content]));
				const usedSourceIds = new Set(
					(edited?.turns ?? []).flatMap((editedTurn) => editedTurn.sourceTurnIds)
				);

				// 編集後ターン（連結時は複数由来）。原文と編集後の差分を持つ。
				const editedItems = (edited?.turns ?? []).map((editedTurn) => {
					const sourceIds = [...editedTurn.sourceTurnIds].sort(
						(a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0)
					);
					const { name, role } = speakerLabel(editedTurn.speakerType, editedTurn.personaId);
					// 由来ターン（連結時は複数）の原文を結合し、編集後との差分を取る。
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

				// どの編集後ターンにも由来として使われなかった原本ターン＝発言ごと削除されたもの。
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

				// 編集後ターンと削除ターンを原本の時系列順に混在させて表示する。
				const turns = [...editedItems, ...removedItems]
					.sort((a, b) => a.sortIndex - b.sortIndex)
					.map((entry) => entry.turn);
				return { id: chapter.id, title: chapter.title, status, failureReason, turns };
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
			return { id: chapter.id, title: chapter.title, status, failureReason, turns };
		});
	});

	// 討論後コメント。編集後（editedPostDebateComments）を優先し、未生成なら原本にフォールバックする
	// （章と同じ編集後優先・原本フォールバックの方針）。話者名・役割は personas から解決する。
	type DisplayComment = {
		id: string;
		name: string;
		role: string;
		content: string;
		// 原本コメント→編集後のインライン差分。編集後がある場合のみ持つ。
		diff: InlineDiffSegment[] | null;
	};

	const displayComments = $derived.by((): DisplayComment[] => {
		const rawComments = currentTopicStore.postDebateCommentsStore.comments;
		const editedComments = currentTopicStore.editedPostDebateCommentsStore.comments;
		const rawContentById = new Map(rawComments.map((comment) => [comment.id, comment.content]));
		if (editedComments.length > 0) {
			return [...editedComments]
				.sort((a, b) => a.sortOrder - b.sortOrder)
				.map((comment) => {
					const { name, role } = speakerLabel('persona', comment.personaId);
					const sourceText = rawContentById.get(comment.sourceCommentId) ?? '';
					return {
						id: comment.id,
						name,
						role,
						content: comment.content,
						diff: computeInlineDiff(sourceText, comment.content)
					};
				});
		}
		// フォールバック: 原本の討論後コメントをそのまま表示する（差分なし）。
		return [...rawComments]
			.sort((a, b) => a.sortOrder - b.sortOrder)
			.map((comment) => {
				const { name, role } = speakerLabel('persona', comment.personaId);
				return { id: comment.id, name, role, content: comment.content, diff: null };
			});
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
			description: '現在の編集成果物がすべて削除され、最初から編集し直します。',
			submitLabel: '編集をやり直す'
		}}
		onGenerate={start}
		onRegenerate={regenerate}
	>
		{#snippet progress()}
			{#if logicalState === 'running'}
				<p class="phase6-editing__editing-progress">編集中...</p>
			{/if}
		{/snippet}
		{#snippet content()}
			{#if intro}
				<!-- イントロ＝章群の前。本編（章・ターン）と区別できるセクションで表示する（Req 4.1, 4.2） -->
				<section class="phase6-editing__intro-closing phase6-editing__intro-closing--intro">
					<h3 class="phase6-editing__intro-closing-label">イントロ</h3>
					<p class="phase6-editing__intro-closing-body">{intro}</p>
				</section>
			{/if}
			{#if displayChapters.length}
				<div class="phase6-editing__diff-toggle">
					<Checkbox bind:value={showDiff}
						>原本との差分を表示（<del>削除</del> / <ins>追加</ins>）</Checkbox
					>
				</div>
				<div class="phase6-editing__chapters">
					{#each displayChapters as chapter (chapter.id)}
						<section class="phase6-editing__chapter">
							<header class="phase6-editing__chapter-header">
								<strong>{chapter.title}</strong>
								<span class="phase6-editing__chapter-status" data-status={chapter.status}>
									{statusLabel(chapter.status)}
								</span>
								{#if chapter.failureReason}
									<span class="phase6-editing__failure-reason"
										>検証不合格: {chapter.failureReason}</span
									>
								{/if}
							</header>
							<div class="phase6-editing__turns">
								{#each chapter.turns as turn (turn.id)}
									{#if turn.removed}
										<!-- 発言ごとカットされた原本ターン。差分表示時のみ取消線で見せる。 -->
										{#if showDiff}
											<div
												class="phase6-editing__turn phase6-editing__turn--removed"
												class:phase6-editing__turn--facilitator={turn.name === 'ファシリテーター'}
											>
												<div class="phase6-editing__speaker">
													<strong>{turn.name}</strong>
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
												<strong>{turn.name}</strong>
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
			{#if displayComments.length}
				<!-- 討論後コメント＝本編（章）の後、クロージングの前。参加者の締めの所感。 -->
				<section class="phase6-editing__post-comments">
					<h3 class="phase6-editing__post-comments-label">討論後コメント</h3>
					<div class="phase6-editing__post-comments-list">
						{#each displayComments as comment (comment.id)}
							<div class="phase6-editing__post-comment">
								<div class="phase6-editing__speaker">
									<strong>{comment.name}</strong>
									{#if comment.role}<span class="phase6-editing__role">({comment.role})</span>{/if}
								</div>
								{#if showDiff && comment.diff}
									<p class="phase6-editing__content"><DiffText segments={comment.diff} /></p>
								{:else}
									<p class="phase6-editing__content">{comment.content}</p>
								{/if}
							</div>
						{/each}
					</div>
				</section>
			{/if}
			{#if closing}
				<!-- クロージング＝章群の後。本編と区別できるセクションで表示する（Req 4.1, 4.3） -->
				<section class="phase6-editing__intro-closing phase6-editing__intro-closing--closing">
					<h3 class="phase6-editing__intro-closing-label">クロージング</h3>
					<p class="phase6-editing__intro-closing-body">{closing}</p>
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
	.phase6-editing__intro-closing {
		padding: 16px;
		margin-bottom: 24px;
		border-left: 4px solid #7b1fa2;
		background: #faf5fd;
		border-radius: 3px;
	}
	.phase6-editing__intro-closing--closing {
		margin-top: 24px;
		margin-bottom: 0;
	}
	.phase6-editing__intro-closing-label {
		margin: 0 0 8px;
		font-size: 0.8rem;
		font-weight: 700;
		color: #7b1fa2;
	}
	.phase6-editing__intro-closing-body {
		margin: 0;
		line-height: 1.7;
		white-space: pre-wrap;
	}
	.phase6-editing__editing-progress {
		color: #1565c0;
		font-size: 0.95rem;
	}
	.phase6-editing__diff-toggle {
		margin-bottom: 16px;
		font-size: 0.9rem;
	}
	.phase6-editing__diff-toggle ins {
		background: #e6ffed;
		color: #22863a;
		text-decoration: none;
		padding: 0 2px;
	}
	.phase6-editing__diff-toggle del {
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
	}
	.phase6-editing__role {
		color: #757575;
		font-size: 0.875rem;
		margin-left: 4px;
	}
	.phase6-editing__speech-mode {
		font-size: 0.75rem;
		margin-left: 6px;
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
		color: #555;
		list-style: none;
		padding: 0;
	}
	.phase6-editing__post-comments {
		margin-top: 24px;
		padding: 16px;
		border-left: 4px solid #00838f;
		background: #f0fafb;
		border-radius: 3px;
	}
	.phase6-editing__post-comments-label {
		margin: 0 0 12px;
		font-size: 0.8rem;
		font-weight: 700;
		color: #00838f;
	}
	.phase6-editing__post-comments-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.phase6-editing__post-comment {
		padding: 12px;
		border-left: 4px solid #e0e0e0;
		background: #fff;
	}
</style>
