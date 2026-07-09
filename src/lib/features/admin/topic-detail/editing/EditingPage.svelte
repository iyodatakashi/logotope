<script lang="ts">
	import { Checkbox, Button } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import DiffText from './DiffText.svelte';
	import { computeInlineDiff, type InlineDiffSegment } from './inlineDiff';
	import NarrationSection from './NarrationSection.svelte';
	import ImpressionSection from './ImpressionSection.svelte';
	import type { Chapter } from '$lib/models/chapter/chapter.types';
	import type {
		EditedChapter,
		EditedChapterDisplayStatus
	} from '$lib/models/editedChapter/editedChapter.types';
	import type { ArticleElement } from '$lib/models/editorial/editorial.types';

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

	// 編集の生成が走り終えたか（generated=全章成功 / stopped=途中終了。どちらも「もう動いていない」）。
	// 章（本体）の未完成明示・再生成ボタンの表示にのみ使う（章ステータスは本 spec の対象外で従来通り）。
	// 導入・締め・所感の記事要素は各自の進捗ステータスで表示を決めるため、このフラグに依存しない（Req 2.1, 2.2）。
	const isEditingFinished = $derived(logicalState === 'generated' || logicalState === 'stopped');

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
			const turns =
				status === 'completed'
					? buildEditedTurns(chapter, store.getEditedChapter(chapter.id))
					: buildRawTurns(chapter);
			return { id: chapter.id, title: chapter.title, status, failureReason, canRegenerate, turns };
		});
	});

	// 編集済み章: 編集後ターン（原本ターンを統合しうる）と、どこにも使われず削除された原本ターンを、
	// 原本の順序でひとつの列にマージする。差分は結合元テキストと編集後テキストの比較で出す。
	const buildEditedTurns = (chapter: Chapter, edited: EditedChapter | null): DisplayTurn[] => {
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

		return [...editedItems, ...removedItems]
			.sort((a, b) => a.sortIndex - b.sortIndex)
			.map((entry) => entry.turn);
	};

	// 未編集・失敗の章のフォールバック: 原本ターンをそのまま表示する（差分なし）。
	const buildRawTurns = (chapter: Chapter): DisplayTurn[] =>
		chapter.turns.map((turn) => {
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

	// 所感（impressions）。承認済みペルソナ単位に name/role と所感オブジェクト(part)を組み立てる。
	// エントリの無いペルソナは生成待ち（pending）として扱い、進捗ステータスで表示を決める（Req 6.2）。
	// 表示分岐（スケルトン／編集済み／編集失敗／生成失敗）は ImpressionSection 内が part.status＋内容から決める。
	const displayImpressions = $derived.by(() => {
		const impressions = currentTopicStore.editorialStore.impressions;
		return currentTopicStore.personasStore.personas
			.filter((persona) => persona.approved)
			.map((persona) => {
				const { name, role } = speakerLabel('persona', persona.id);
				const part = impressions.find((item) => item.personaId === persona.id) ?? {
					status: 'pending' as const,
					draft: null,
					final: null
				};
				return { personaId: persona.id, name, role, part };
			});
	});
</script>

{#if !debateCompleted}
	<!-- 討論完了前は編集開始操作を出さない（画面側の大前提ゲート・Req 5.4） -->
	<div class="editing-page__editing-gate">討論が完了すると編集を開始できます。</div>
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
				<span class="editing-page__diff-legend">
					<Checkbox bind:value={showDiff}
						>原本との差分を表示（<del>削除</del> / <ins>追加</ins>）</Checkbox
					>
				</span>
			{/if}
		{/snippet}
		{#snippet content()}
			<div class="editing-page__content">
				<!-- 導入（intro）＝記事の先頭。生成前でも枠は常に出す。 -->
				<NarrationSection
					label="導入"
					part={currentTopicStore.editorialStore.intro}
					{showDiff}
					regenerating={regeneratingKeys['intro']}
					onRegenerate={() => regenerateElement({ kind: 'intro' })}
				/>

				<!-- 本体（body＝章） -->
				{#if displayChapters.length}
					<div class="editing-page__chapters">
						{#each displayChapters as chapter (chapter.id)}
							<section class="editing-page__chapter">
								<header class="editing-page__chapter-header">
									<div class="editing-page__chapter-title">{chapter.title}</div>
									<span class="editing-page__chapter-status" data-status={chapter.status}>
										{statusLabel(chapter.status)}
									</span>
									{#if chapter.failureReason}
										<span class="editing-page__failure-reason"
											>検証不合格: {chapter.failureReason}</span
										>
									{/if}
									{#if isEditingFinished && chapter.canRegenerate}
										<Button
											variant="outlined"
											onclick={() => regenerateElement({ kind: 'chapter', chapterId: chapter.id })}
											loading={regeneratingKeys[`chapter:${chapter.id}`]}
										>
											再生成
										</Button>
									{/if}
								</header>
								<div class="editing-page__turns">
									{#each chapter.turns as turn (turn.id)}
										{#if turn.removed}
											{#if showDiff}
												<div
													class="editing-page__turn editing-page__turn--removed"
													class:editing-page__turn--facilitator={turn.name === 'ファシリテーター'}
												>
													<div class="editing-page__speaker">
														<div class="editing-page__speaker-name">{turn.name}</div>
														{#if turn.role}<span class="editing-page__role">({turn.role})</span
															>{/if}
														<span class="editing-page__removed-label">発言ごと削除</span>
													</div>
													<p class="editing-page__content"><del>{turn.content}</del></p>
												</div>
											{/if}
										{:else}
											<div
												class="editing-page__turn"
												class:editing-page__turn--facilitator={turn.name === 'ファシリテーター'}
											>
												<div class="editing-page__speaker">
													<div class="editing-page__speaker-name">{turn.name}</div>
													{#if turn.role}<span class="editing-page__role">({turn.role})</span>{/if}
													{#if turn.speechMode}
														<span class="editing-page__speech-mode" data-mode={turn.speechMode}
															>{turn.speechMode}</span
														>
													{/if}
												</div>
												{#if showDiff && turn.diff}
													<p class="editing-page__content"><DiffText segments={turn.diff} /></p>
												{:else}
													<p class="editing-page__content">{turn.content}</p>
												{/if}
												{#if turn.awarenesses.length > 0}
													<ul class="editing-page__awarenesses">
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

				<!-- 締め（outro）＝本体の後。生成前でも枠は常に出す。 -->
				<NarrationSection
					label="締め"
					part={currentTopicStore.editorialStore.outro}
					{showDiff}
					regenerating={regeneratingKeys['outro']}
					onRegenerate={() => regenerateElement({ kind: 'outro' })}
				/>

				<!-- 所感（impressions）＝締めの後。参加者ごとの締めの所感。 -->
				{#if displayImpressions.length}
					<section class="editing-page__impressions">
						<h3 class="editing-page__impressions-label">所感</h3>
						<div class="editing-page__impressions-list">
							{#each displayImpressions as impression (impression.personaId)}
								<ImpressionSection
									name={impression.name}
									role={impression.role}
									part={impression.part}
									{showDiff}
									regenerating={regeneratingKeys[`impression:${impression.personaId}`]}
									onRegenerate={() =>
										regenerateElement({ kind: 'impression', personaId: impression.personaId })}
								/>
							{/each}
						</div>
					</section>
				{/if}
			</div>
		{/snippet}
	</PhasePanel>
{/if}

<style>
	.editing-page__editing-gate {
		padding: 24px;
		color: #757575;
		font-size: 0.95rem;
	}

	.editing-page__content {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.editing-page__diff-legend ins {
		background: #e6ffed;
		color: #22863a;
		text-decoration: none;
		padding: 0 2px;
	}
	.editing-page__diff-legend del {
		background: #ffeef0;
		color: #b31d28;
		padding: 0 2px;
	}
	.editing-page__chapters {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	.editing-page__chapter-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}
	.editing-page__chapter-title {
		font-size: 1.5rem;
		font-weight: bold;
	}
	.editing-page__chapter-status {
		font-size: 0.75rem;
		padding: 1px 6px;
		border-radius: 3px;
		background: #eee;
		color: #757575;
	}
	.editing-page__chapter-status[data-status='completed'] {
		background: #e8f5e9;
		color: #2e7d32;
	}
	.editing-page__chapter-status[data-status='failed'] {
		background: #ffebee;
		color: #c62828;
	}
	.editing-page__failure-reason {
		font-size: 0.78rem;
		color: #c62828;
	}
	.editing-page__turns {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.editing-page__turn {
		padding: 12px;
		border-left: 4px solid #e0e0e0;
	}
	.editing-page__turn.editing-page__turn--facilitator {
		border-left-color: #1565c0;
		background: #f8f9ff;
	}
	.editing-page__turn.editing-page__turn--removed {
		border-left-color: #e57373;
		background: #fff5f5;
	}
	.editing-page__turn.editing-page__turn--removed .editing-page__content del {
		color: #b31d28;
		text-decoration: line-through;
	}
	.editing-page__removed-label {
		font-size: 0.72rem;
		margin-left: 6px;
		color: #fff;
		background: #c62828;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.editing-page__speaker {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}
	.editing-page__speaker-name {
		font-weight: bold;
	}
	.editing-page__role {
		color: #757575;
		font-size: 0.875rem;
	}
	.editing-page__speech-mode {
		font-size: 0.75rem;
		color: #555;
		background: #eee;
		padding: 1px 5px;
		border-radius: 3px;
	}
	.editing-page__content {
		margin: 0;
		line-height: 1.6;
	}
	.editing-page__awarenesses {
		margin-top: 8px;
		font-size: 0.85rem;
		color: var(--svelte-ui-text-subtle-color);
		list-style: none;
		padding: 0;
	}
	.editing-page__impressions {
		margin-top: 24px;
		padding: 16px;
		border-left: 4px solid #00838f;
		background: #f0fafb;
		border-radius: 3px;
	}
	.editing-page__impressions-label {
		margin: 0 0 12px;
		font-size: 0.8rem;
		font-weight: 700;
		color: #00838f;
	}
	.editing-page__impressions-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
</style>
