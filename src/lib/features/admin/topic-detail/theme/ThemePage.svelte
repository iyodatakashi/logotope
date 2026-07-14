<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button, Input, Textarea } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseLogicalState, phasePath, nextPhase } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import PhasePanel from '$lib/sharedComponents/PhasePanel.svelte';
	import {
		TITLE_MAX_LENGTH,
		DESCRIPTION_MAX_LENGTH,
		MAX_SOURCE_URLS
	} from '$lib/models/topic/topic.constants';

	const PHASE: PhaseSlug = 'theme';

	// テーマ設定は生成を伴わないため、状態は not_started（設定中）か approved（承認済み）のみ。
	const logicalState = $derived.by(() => {
		const topic = currentTopicStore.topic;
		return topic
			? phaseLogicalState({ phase: topic.phase, phaseStatus: topic.phaseStatus }, PHASE)
			: 'not_started';
	});

	let approveError = $state('');
	let isApproving = $state(false);

	const titleError = $derived.by(() => {
		const title = currentTopicStore.topic?.title ?? '';
		if (!title.trim()) return 'タイトルを入力してください';
		if (title.length > TITLE_MAX_LENGTH) return `${TITLE_MAX_LENGTH}文字以内で入力してください`;
		return '';
	});
	const descriptionError = $derived(
		(currentTopicStore.topic?.description.length ?? 0) > DESCRIPTION_MAX_LENGTH
			? `${DESCRIPTION_MAX_LENGTH}文字以内で入力してください`
			: ''
	);
	const urlErrors = $derived(
		(currentTopicStore.topic?.sourceUrls ?? []).map((url) =>
			url && !url.startsWith('https://') && !url.startsWith('http://')
				? 'https:// または http:// で始まるURLを入力してください'
				: ''
		)
	);
	const isValid = $derived(
		!titleError && !descriptionError && urlErrors.every((urlError) => !urlError)
	);

	// 編集内容をトピックに保存する（不正な値は保存しない）。
	const save = async () => {
		const topic = currentTopicStore.topic;
		if (!topic || !isValid) return;
		await topic.save();
	};

	const addUrl = () => {
		const topic = currentTopicStore.topic;
		if (topic && topic.sourceUrls.length < MAX_SOURCE_URLS) topic.sourceUrls.push('');
	};

	const removeUrl = (urlIndex: number) => {
		currentTopicStore.topic?.sourceUrls.splice(urlIndex, 1);
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
			if (topic.sourceUrls.some((url) => url.trim())) await topic.fetchSourceContents();
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
		{#if currentTopicStore.topic}
			<div class="theme-page__content">
				<div class="theme-page__field">
					<label for="theme-title">タイトル</label>
					<Input
						id="theme-title"
						bind:value={currentTopicStore.topic.title}
						onchange={save}
						placeholder="討論テーマのタイトルを入力してください（{TITLE_MAX_LENGTH}文字以内）"
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
						bind:value={currentTopicStore.topic.description}
						onchange={save}
						placeholder="テーマの背景・文脈を入力してください（任意・{DESCRIPTION_MAX_LENGTH}文字以内）"
						rows={6}
						fullWidth
					/>
					{#if descriptionError}
						<p class="theme-page__error" role="alert">{descriptionError}</p>
					{/if}
				</div>

				<div class="theme-page__field">
					<p>参考URL（任意・最大{MAX_SOURCE_URLS}件）</p>
					{#each currentTopicStore.topic.sourceUrls as _url, urlIndex (urlIndex)}
						<div class="theme-page__url-row">
							<Input
								bind:value={currentTopicStore.topic.sourceUrls[urlIndex]}
								onchange={save}
								ariaLabel={`参考URL ${urlIndex + 1}`}
								placeholder="https://"
								fullWidth
							/>
							<Button type="button" variant="ghost" onclick={() => removeUrl(urlIndex)}>削除</Button
							>
						</div>
						{#if urlErrors[urlIndex]}
							<p class="theme-page__error" role="alert">{urlErrors[urlIndex]}</p>
						{/if}
					{/each}
					{#if currentTopicStore.topic.sourceUrls.length < MAX_SOURCE_URLS}
						<Button type="button" variant="outlined" onclick={addUrl}>URLを追加</Button>
					{/if}
				</div>
			</div>
		{/if}
	{/snippet}
</PhasePanel>

<style>
	.theme-page__content {
		display: flex;
		flex-direction: column;
		gap: 24px;
		max-width: 960px;
		margin: 0 auto;
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
