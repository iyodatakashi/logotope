<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button, Input, Textarea } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath, nextPhase } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';

	const PHASE: PhaseSlug = 'theme';
	const MAX_SOURCE_URLS = 5;

	// テーマ設定は生成を伴わないため、状態は not_started（設定中）か approved（承認済み）のみ。
	const logicalState = $derived.by(() => {
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});

	// テーマの編集用ドラフト。永続データ（topic）が変わるたびに同期する。
	let draftTitle = $state('');
	let draftDescription = $state('');
	let draftSourceUrls = $state<string[]>([]);
	$effect(() => {
		const topic = currentTopicStore.topic;
		draftTitle = topic?.title ?? '';
		draftDescription = topic?.description ?? '';
		draftSourceUrls = topic?.sourceUrls ? [...topic.sourceUrls] : [];
	});

	let approveError = $state('');
	let isApproving = $state(false);

	const titleError = $derived.by(() => {
		if (!draftTitle.trim()) return 'タイトルを入力してください';
		if (draftTitle.length > 500) return '500文字以内で入力してください';
		return '';
	});
	const descriptionError = $derived(
		draftDescription.length > 2000 ? '2000文字以内で入力してください' : ''
	);
	const urlErrors = $derived(
		draftSourceUrls.map((url) =>
			url && !url.startsWith('https://') && !url.startsWith('http://')
				? 'https:// または http:// で始まるURLを入力してください'
				: ''
		)
	);
	const isValid = $derived(
		!titleError && !descriptionError && urlErrors.every((urlError) => !urlError)
	);

	// 入力内容をトピックに保存する（不正な値は保存しない）。空URL行は保存対象から除く。
	const save = async () => {
		const topic = currentTopicStore.topic;
		if (!topic || !isValid) return;
		await topic.saveTheme({
			title: draftTitle.trim(),
			description: draftDescription,
			sourceUrls: $state.snapshot(draftSourceUrls).filter((url) => url.trim())
		});
	};

	const addUrl = () => {
		if (draftSourceUrls.length < MAX_SOURCE_URLS) draftSourceUrls.push('');
	};

	const removeUrl = (urlIndex: number) => {
		draftSourceUrls.splice(urlIndex, 1);
		save();
	};

	// 承認: テーマを保存し、参考URLがあれば本文を取得してから事実リサーチフェーズへ前進する。
	const approve = async () => {
		const topic = currentTopicStore.topic;
		if (!topic || !isValid) return;
		isApproving = true;
		approveError = '';
		try {
			await save();
			if (draftSourceUrls.some((url) => url.trim())) await topic.fetchSourceContents();
			await topic.approveTheme();
			const next = nextPhase(PHASE);
			if (next) goto(phasePath(topic.id, next));
		} catch {
			approveError = '参考URLの本文取得に失敗しました。URLを確認して再試行してください。';
		} finally {
			isApproving = false;
		}
	};
</script>

<PhasePanel>
	{#snippet actions()}
		<div class="theme-page__actions">
			{#if logicalState === 'not_started'}
				<Button variant="filled" loading={isApproving} disabled={!isValid} onclick={approve}>
					承認して次へ進む
				</Button>
			{/if}
			{#if approveError}
				<p class="theme-page__error" role="alert">{approveError}</p>
			{/if}
		</div>
	{/snippet}

	{#snippet content()}
		<div class="theme-page">
			<div class="theme-page__field">
				<label for="theme-title">タイトル</label>
				<Input
					id="theme-title"
					bind:value={draftTitle}
					onchange={save}
					placeholder="討論テーマのタイトルを入力してください（500文字以内）"
					fullWidth
				/>
				{#if titleError}
					<p class="theme-page__error" role="alert">{titleError}</p>
				{/if}
			</div>

			<div class="theme-page__field">
				<label for="theme-description">詳細説明</label>
				<Textarea
					id="theme-description"
					bind:value={draftDescription}
					onchange={save}
					placeholder="テーマの背景・文脈を入力してください（任意・2000文字以内）"
					rows={6}
					fullWidth
				/>
				{#if descriptionError}
					<p class="theme-page__error" role="alert">{descriptionError}</p>
				{/if}
			</div>

			<div class="theme-page__field">
				<p>参考URL（任意・最大{MAX_SOURCE_URLS}件）</p>
				{#each draftSourceUrls as _url, urlIndex (urlIndex)}
					<div class="theme-page__url-row">
						<Input
							bind:value={draftSourceUrls[urlIndex]}
							onchange={save}
							ariaLabel={`参考URL ${urlIndex + 1}`}
							placeholder="https://"
							fullWidth
						/>
						<Button type="button" variant="ghost" onclick={() => removeUrl(urlIndex)}>削除</Button>
					</div>
					{#if urlErrors[urlIndex]}
						<p class="theme-page__error" role="alert">{urlErrors[urlIndex]}</p>
					{/if}
				{/each}
				{#if draftSourceUrls.length < MAX_SOURCE_URLS}
					<Button type="button" variant="outlined" onclick={addUrl}>URLを追加</Button>
				{/if}
			</div>
		</div>
	{/snippet}
</PhasePanel>

<style>
	.theme-page {
		display: flex;
		flex-direction: column;
		gap: 24px;
		max-width: 800px;
	}

	.theme-page__field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.theme-page__url-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.theme-page__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.theme-page__error {
		color: var(--svelte-ui-error-color);
		font-size: var(--svelte-ui-font-size-sm);
	}
</style>
