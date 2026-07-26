<script lang="ts">
	import { Button, Checkbox, ConfirmDialog } from '@14ch/svelte-ui';
	import { goto } from '$app/navigation';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseEditable, phaseLogicalState, phasePath } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import AdminTopicDetailTemplate from '$lib/features/admin/topic-detail/AdminTopicDetailTemplate.svelte';
	import EditingNarration from './EditingNarration.svelte';
	import EditingImpression from './EditingImpression.svelte';
	import EditingChapter from './EditingChapter.svelte';
	import type { Chapter, EditedChapter } from '$lib/models/chapter/chapter.types';
	import type { TurnForEditing } from '$lib/models/turn/turn.types';
	import type { ArticleElement } from '$lib/models/editorial/editorial.types';

	const PHASE: PhaseSlug = 'editing';
	// 編集後ターンで原本との差分（削除＝赤取消線 / 追加＝緑）を強調表示するかどうか。
	let showDiff = $state(true);
	// 押下直後の楽観的な「実行中」表示用フラグ。実状態(running)が反映されたら解除する。
	let isStarting = $state(false);
	// 「次に進む」押下中の loading・多重押下抑止と、承認失敗時のエラー表示。
	let isApproving = $state(false);
	let approveError = $state('');

	let regenerateDialog: ReturnType<typeof ConfirmDialog> | undefined = $state();

	// =========================================================================
	// Effects
	// =========================================================================

	$effect(() => {
		const topic = currentTopicStore.topic;
		if (
			topic &&
			phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE) === 'running'
		) {
			isStarting = false;
		}
	});

	// =========================================================================
	// Methods
	// =========================================================================

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

	// やり直し: 開始操作（startEditing）を1回呼ぶだけ。旧記事の破棄＋実行中化＋新世代発行はサーバの
	// startEditingRun が担う。editing は最終フェーズのため先行フェーズ確定・下流破棄は不要（明示リセットを外す）。
	const regenerate = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		isStarting = true;
		try {
			await topic.startEditing();
		} finally {
			isStarting = false;
		}
	};

	// 前に戻る: 討論画面へ戻るだけ（討論未完了でも操作ペインから戻れる）。phase/生成データは変更しない。
	const handleBackClick = () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		goto(phasePath(topic.id, 'debate'));
	};

	// 承認を「次に進む」に畳み込む。編集完了で活性。未承認なら編集を確定してから公開画面へ遷移し、
	// 失敗時は遷移せずエラーを表示する（フェーズ不変）。
	const handleForwardClick = async () => {
		const topic = currentTopicStore.topic;
		if (!topic || !canAdvance) return;
		isApproving = true;
		approveError = '';
		try {
			if (logicalState !== 'approved') await topic.approveEditing();
			goto(phasePath(topic.id, 'publish'));
		} catch {
			approveError = '編集の確定に失敗しました。時間をおいて再試行してください。';
		} finally {
			isApproving = false;
		}
	};

	// 記事要素（導入・締め・所感・章）の個別再生成はサーバへ委譲するだけ。処理中のローディングは各 Section が
	// 自持ちする（クリック→サーバが生成中を書くまでの遅延分。以降は要素の状態が引き継いで表示する）。
	const regenerateArticleElement = (articleElement: ArticleElement): Promise<void> => {
		return currentTopicStore.topic?.regenerateArticleElement(articleElement) ?? Promise.resolve();
	};

	// 編集済み章: 編集後ターン（原本ターンを統合しうる）と、どこにも使われず削除された原本ターンを、原本順に1列へマージする。
	const buildEditedTurns = (chapter: Chapter, edited: EditedChapter | null): TurnForEditing[] => {
		const orderOf = new Map(chapter.turns.map((turn, i) => [turn.id, i]));
		const usedSourceIds = new Set(
			(edited?.turns ?? []).flatMap((editedTurn) => editedTurn.sourceTurnIds)
		);

		const editedItems = (edited?.turns ?? []).map((editedTurn) => {
			// sourceTurnIds は差分・気づきの由来として原本順に並べておく（描画側で content を結合するため）。
			const sourceTurnIds = [...editedTurn.sourceTurnIds].sort(
				(a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0)
			);
			const turn: TurnForEditing = { ...editedTurn, sourceTurnIds, removed: false };
			return {
				sortIndex: Math.min(...sourceTurnIds.map((sourceId) => orderOf.get(sourceId) ?? 0)),
				turn
			};
		});

		const removedItems = chapter.turns
			.filter((rawTurn) => !usedSourceIds.has(rawTurn.id))
			.map((rawTurn) => {
				const turn: TurnForEditing = {
					id: rawTurn.id,
					sourceTurnIds: [rawTurn.id],
					speakerType: rawTurn.speakerType,
					personaId: rawTurn.personaId ?? null,
					content: rawTurn.content,
					speechMode: rawTurn.speechMode,
					removed: true
				};
				return { sortIndex: orderOf.get(rawTurn.id) ?? 0, turn };
			});

		return [...editedItems, ...removedItems]
			.sort((a, b) => a.sortIndex - b.sortIndex)
			.map((entry) => entry.turn);
	};

	// 未編集・失敗の章のフォールバック: 原本ターンをそのまま1行として並べる（差分は描画時に自テキスト比較＝変化なし）。
	const buildRawTurns = (chapter: Chapter): TurnForEditing[] =>
		chapter.turns.map((turn) => ({
			id: turn.id,
			sourceTurnIds: [turn.id],
			speakerType: turn.speakerType,
			personaId: turn.personaId ?? null,
			content: turn.content,
			speechMode: turn.speechMode,
			removed: false
		}));

	// =========================================================================
	// Derived States
	// =========================================================================

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

	const logicalState = $derived.by(() => {
		if (isStarting) return 'running';
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});

	// 「次に進む」の活性条件。編集生成完了（generated）または前進済み（approved）で活性。
	const canAdvance = $derived(logicalState === 'generated' || logicalState === 'approved');

	// 公開中はコンテンツ変更操作（編集の開始・やり直し・各要素の再生成）を凍結する（閲覧・遷移は許可）。
	const editable = $derived(
		phaseEditable({ published: currentTopicStore.topic?.published ?? false }, PHASE)
	);

	// 編集の生成が走り終えたか（generated=全章成功 / stopped=途中終了。どちらも「もう動いていない」）。
	// 章（本体）の未完成明示・再生成ボタンの表示にのみ使う（章ステータスは本 spec の対象外で従来通り）。
	// 導入・締め・所感の記事要素は各自の進捗ステータスで表示を決めるため、このフラグに依存しない（Req 2.1, 2.2）。
	const isEditingFinished = $derived(logicalState === 'generated' || logicalState === 'stopped');

	// 原本章順に、章別の編集状態と表示ターン（TurnForEditing）を組み立てる（本体＝body）。
	// name/role・差分・気づきは畳まず、EditingChapter が store（personaMap・getAwarenessesByTurn）・原本ターンから描画時に解決する。
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
			// 差分算出の由来テキスト参照用に、その章の原本ターンを併せて渡す。
			return {
				id: chapter.id,
				title: chapter.title,
				status,
				failureReason,
				canRegenerate,
				turns,
				sourceTurns: chapter.turns
			};
		});
	});

	// 所感（impressions）。承認済みペルソナ単位に personaId と所感オブジェクト(part)を組み立てる。
	// 話者名/役割は畳まず、EditingImpression が personaMap から描画時に解決する（Req 3.1/3.4）。
	// エントリの無いペルソナは生成待ち（pending）として扱い、進捗ステータスで表示を決める（Req 6.2）。
	// 表示分岐（スケルトン／編集済み／編集失敗／生成失敗）は ImpressionSection 内が part.status＋内容から決める。
	const displayImpressions = $derived.by(() => {
		const impressions = currentTopicStore.editorialStore.impressions;
		return currentTopicStore.personasStore.personas
			.filter((persona) => persona.selected)
			.map((persona) => {
				const part = impressions.find((item) => item.personaId === persona.id) ?? {
					status: 'pending' as const,
					draft: null,
					final: null
				};
				return { personaId: persona.id, part };
			});
	});
</script>

<AdminTopicDetailTemplate>
	{#snippet actions()}
		<div class="editing-page__actions">
			<Button variant="outlined" icon="arrow_back" rounded onclick={handleBackClick}>
				前に戻る
			</Button>
			<div class="editing-page__center">
				{#if debateCompleted}
					{#if logicalState === 'running'}
						<Button variant="ghost" rounded icon="cached" loading onclick={() => {}}>
							編集を開始する
						</Button>
					{:else if logicalState === 'not_started'}
						<Button variant="filled" rounded icon="cached" disabled={!editable} onclick={start}>
							編集を開始する
						</Button>
					{:else}
						<Button
							variant="filled"
							rounded
							icon="cached"
							color="var(--danger-color)"
							disabled={!editable}
							onclick={() => regenerateDialog?.open()}
						>
							編集をやり直す
						</Button>
					{/if}
				{/if}
			</div>
			<div class="editing-page__forward">
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
					<p class="editing-page__error" role="alert">{approveError}</p>
				{/if}
			</div>
		</div>
	{/snippet}
	{#snippet content()}
		<div class="editing-page__content">
			{#if !debateCompleted}
				<!-- 討論完了前は編集開始の前提を満たさない（画面側の大前提ゲート・Req 6.10） -->
				<div class="editing-page__editing-gate">討論が完了すると編集を開始できます。</div>
			{:else}
				<div class="editing-page__content">
					{#if displayChapters.length}
						<div class="editing-page__toolbar">
							<Checkbox bind:value={showDiff}>原本との差分を表示</Checkbox>
						</div>
					{/if}

					<!-- 導入（intro）＝記事の先頭。生成前でも枠は常に出す。 -->
					<EditingNarration
						label="導入"
						part={currentTopicStore.editorialStore.intro}
						{showDiff}
						{editable}
						onRegenerate={() => regenerateArticleElement({ kind: 'intro' })}
					/>

					<!-- 本体（body＝章） -->
					{#if displayChapters.length}
						<div class="editing-page__chapters">
							{#each displayChapters as chapter (chapter.id)}
								<EditingChapter
									title={chapter.title}
									status={chapter.status}
									failureReason={chapter.failureReason}
									showRegenerate={isEditingFinished && chapter.canRegenerate}
									turns={chapter.turns}
									sourceTurns={chapter.sourceTurns}
									{showDiff}
									{editable}
									onRegenerate={() =>
										regenerateArticleElement({ kind: 'chapter', chapterId: chapter.id })}
								/>
							{/each}
						</div>
					{/if}

					<!-- 締め（outro）＝本体の後。生成前でも枠は常に出す。 -->
					<EditingNarration
						label="締め"
						part={currentTopicStore.editorialStore.outro}
						{showDiff}
						{editable}
						onRegenerate={() => regenerateArticleElement({ kind: 'outro' })}
					/>

					<!-- 所感（impressions）＝締めの後。参加者ごとの締めの所感。 -->
					{#if displayImpressions.length}
						<section class="editing-page__impressions">
							<h3 class="editing-page__impressions-label">所感</h3>
							<div class="editing-page__impressions-list">
								{#each displayImpressions as impression (impression.personaId)}
									<EditingImpression
										personaId={impression.personaId}
										part={impression.part}
										{showDiff}
										{editable}
										onRegenerate={() =>
											regenerateArticleElement({
												kind: 'impression',
												personaId: impression.personaId
											})}
									/>
								{/each}
							</div>
						</section>
					{/if}
				</div>
			{/if}
		</div>
	{/snippet}
</AdminTopicDetailTemplate>

<ConfirmDialog
	bind:this={regenerateDialog}
	title="編集をやり直しますか？"
	description="現在の編集記事がすべて削除され、最初から編集し直します。"
	danger
	submitLabel="編集をやり直す"
	cancelLabel="キャンセル"
	onSubmit={regenerate}
/>

<style>
	.editing-page__actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.editing-page__center {
		display: flex;
		gap: 8px;
	}

	.editing-page__forward {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.editing-page__error {
		color: var(--svelte-ui-error-color);
		font-size: var(--svelte-ui-font-size-sm);
	}

	.editing-page__toolbar {
		display: flex;
		justify-content: flex-end;
	}

	.editing-page__editing-gate {
		padding: 24px;
		color: #757575;
	}

	.editing-page__content {
		display: flex;
		flex-direction: column;
		gap: 24px;
		max-width: 960px;
		margin: 0 auto;
	}

	.editing-page__chapters {
		display: flex;
		flex-direction: column;
		gap: 24px;
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
