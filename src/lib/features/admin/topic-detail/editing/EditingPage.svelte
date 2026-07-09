<script lang="ts">
	import { Checkbox } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import NarrationSection from './NarrationSection.svelte';
	import ImpressionSection from './ImpressionSection.svelte';
	import ChapterSection from './ChapterSection.svelte';
	import type { Chapter, EditedChapter } from '$lib/models/chapter/chapter.types';
	import type { TurnForEditing } from '$lib/models/turn/turn.types';
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

	// 記事要素（導入・締め・所感・章）の個別再生成はサーバへ委譲するだけ。処理中のローディングは各 Section が
	// 自持ちする（クリック→サーバが生成中を書くまでの遅延分。以降は要素の状態が引き継いで表示する）。
	const regenerateArticleElement = (element: ArticleElement): Promise<void> =>
		currentTopicStore.topic?.regenerateArticleElement(element) ?? Promise.resolve();

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


	const personaMap = $derived(currentTopicStore.personasStore.personaMap);

	// 原本ターン id → そのターンを聞いて得た気づき（triggeredByTurnId で紐づく）。
	// 話者名は畳まず personaId 参照のまま保持し、描画時に personaMap で解決する（横断アノテーション）。
	const awarenessesByTurn = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, { personaId: string; content: string }[]>();
		for (const persona of currentTopicStore.personasStore.personas) {
			for (const awareness of persona.awarenesses ?? []) {
				map.set(awareness.triggeredByTurnId, [
					...(map.get(awareness.triggeredByTurnId) ?? []),
					{ personaId: persona.id, content: awareness.content }
				]);
			}
		}
		return map;
	});

	// 原本章順に、章別の編集状態と表示ターン（TurnForEditing）を組み立てる（本体＝body）。
	// name/role・差分・気づきは畳まず、ChapterSection が personaMap・原本ターン・awarenessesByTurn から描画時に解決する。
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

	// 所感（impressions）。承認済みペルソナ単位に personaId と所感オブジェクト(part)を組み立てる。
	// 話者名/役割は畳まず、ImpressionSection が personaMap から描画時に解決する（Req 3.1/3.4）。
	// エントリの無いペルソナは生成待ち（pending）として扱い、進捗ステータスで表示を決める（Req 6.2）。
	// 表示分岐（スケルトン／編集済み／編集失敗／生成失敗）は ImpressionSection 内が part.status＋内容から決める。
	const displayImpressions = $derived.by(() => {
		const impressions = currentTopicStore.editorialStore.impressions;
		return currentTopicStore.personasStore.personas
			.filter((persona) => persona.approved)
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
					onRegenerate={() => regenerateArticleElement({ kind: 'intro' })}
				/>

				<!-- 本体（body＝章） -->
				{#if displayChapters.length}
					<div class="editing-page__chapters">
						{#each displayChapters as chapter (chapter.id)}
							<ChapterSection
								title={chapter.title}
								status={chapter.status}
								failureReason={chapter.failureReason}
								showRegenerate={isEditingFinished && chapter.canRegenerate}
								turns={chapter.turns}
								sourceTurns={chapter.sourceTurns}
								{personaMap}
								{awarenessesByTurn}
								{showDiff}
								onRegenerate={() =>
									regenerateArticleElement({ kind: 'chapter', chapterId: chapter.id })}
							/>
						{/each}
					</div>
				{/if}

				<!-- 締め（outro）＝本体の後。生成前でも枠は常に出す。 -->
				<NarrationSection
					label="締め"
					part={currentTopicStore.editorialStore.outro}
					{showDiff}
					onRegenerate={() => regenerateArticleElement({ kind: 'outro' })}
				/>

				<!-- 所感（impressions）＝締めの後。参加者ごとの締めの所感。 -->
				{#if displayImpressions.length}
					<section class="editing-page__impressions">
						<h3 class="editing-page__impressions-label">所感</h3>
						<div class="editing-page__impressions-list">
							{#each displayImpressions as impression (impression.personaId)}
								<ImpressionSection
									personaId={impression.personaId}
									{personaMap}
									part={impression.part}
									{showDiff}
									onRegenerate={() =>
										regenerateArticleElement({ kind: 'impression', personaId: impression.personaId })}
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
