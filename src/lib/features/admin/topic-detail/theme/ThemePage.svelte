<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button, Input, Textarea } from '@14ch/svelte-ui';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { phaseEditable, phaseLogicalState, phasePath } from '$lib/models/phase/phase';
	import type { PhaseSlug } from '$lib/models/phase/phase.types';
	import AdminTopicDetailTemplate from '$lib/features/admin/topic-detail/AdminTopicDetailTemplate.svelte';
	import {
		TITLE_MAX_LENGTH,
		DESCRIPTION_MAX_LENGTH,
		MAX_SOURCE_URLS
	} from '$lib/models/topic/topic.constants';

	const PHASE: PhaseSlug = 'theme';

	// 公開中はコンテンツ変更操作を凍結する（閲覧・遷移は許可）。
	const editable = $derived(
		phaseEditable({ published: currentTopicStore.topic?.published ?? false }, PHASE)
	);

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

	// 承認を「次に進む」に畳み込む。未承認ならテーマを保存し、参考URLがあれば本文を取得してから
	// テーマを承認し、成功時のみ事実リサーチ画面へ遷移する。失敗時は遷移せずエラーを表示する。
	const handleForwardClick = async () => {
		const topic = currentTopicStore.topic;
		if (!topic || !isValid) return;
		isApproving = true;
		approveError = '';
		try {
			if (logicalState === 'not_started') {
				await save();
				if (topic.sourceUrls.some((url) => url.trim())) await topic.fetchSourceContents();
				await topic.approveTheme();
			}
			goto(phasePath(topic.id, 'fact-research'));
		} catch {
			approveError = '参考URLの本文取得に失敗しました。URLを確認して再試行してください。';
		} finally {
			isApproving = false;
		}
	};
</script>

<AdminTopicDetailTemplate>
	{#snippet actions()}
		<div class="theme-page__actions">
			<Button
				variant="filled"
				icon="arrow_forward"
				iconPosition="right"
				rounded
				loading={isApproving}
				disabled={!isValid}
				onclick={handleForwardClick}
			>
				次に進む
			</Button>
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
						disabled={!editable}
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
						disabled={!editable}
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
								disabled={!editable}
								fullWidth
							/>
							<Button
								type="button"
								variant="ghost"
								disabled={!editable}
								onclick={() => removeUrl(urlIndex)}>削除</Button
							>
						</div>
						{#if urlErrors[urlIndex]}
							<p class="theme-page__error" role="alert">{urlErrors[urlIndex]}</p>
						{/if}
					{/each}
					{#if currentTopicStore.topic.sourceUrls.length < MAX_SOURCE_URLS}
						<Button type="button" variant="outlined" disabled={!editable} onclick={addUrl}>
							URLを追加
						</Button>
					{/if}
				</div>
			</div>
		{/if}
	{/snippet}
</AdminTopicDetailTemplate>

<style>
	.theme-page__actions {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 8px;
	}

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

	.theme-page__error {
		color: var(--svelte-ui-error-color);
		font-size: var(--svelte-ui-font-size-sm);
	}
</style>
