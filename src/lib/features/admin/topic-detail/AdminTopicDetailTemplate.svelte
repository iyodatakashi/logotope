<script lang="ts">
	import { IconButton, Input } from '@14ch/svelte-ui';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import { phaseEditable } from '$lib/models/phase/phase';
	import { type PhaseSlug } from '$lib/models/phase/phase.types';
	import { TITLE_MAX_LENGTH } from '$lib/models/topic/topic.constants';
	import AdminTemplate from '$lib/features/admin/AdminTemplate.svelte';
	import StepNav from '$lib/features/admin/topic-detail/StepNav.svelte';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';

	// トピック詳細（フェーズ）画面の器。共通ヘッダー（題名・StepNav）と、sticky な操作ペイン・
	// スクロールするコンテンツペインを提供する。操作ボタン群・注記・確認ダイアログは画面固有のため、
	// 各画面が actions snippet に直接書く（一元管理しない）。
	interface Props {
		actions?: Snippet; // 操作ペインの中身（ボタン群・注記など）
		content?: Snippet; // コンテンツ本体
		progress?: Snippet; // コンテンツ先頭に置く進捗表示
	}

	let { actions, content, progress }: Props = $props();

	const topicId = page.params.topicId as string;
	const currentPhase = $derived<PhaseSlug>(currentTopicStore.topic?.phase ?? 'theme');

	// 題名を保存する。上限を超えた分は切り詰める（空題名は store 側が保存せず永続値へ戻す）。
	const save = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		topic.title = topic.title.slice(0, TITLE_MAX_LENGTH);
		await topic.save();
	};
</script>

<AdminTemplate>
	<div class="admin-topic-detail-template">
		<div class="admin-topic-detail-template__header">
			<div class="admin-topic-detail-template__title-row">
				<IconButton ariaLabel="戻る" size={40} onclick={() => goto('/admin/topics')}
					>arrow_back</IconButton
				>
				{#if currentTopicStore.topic}
					<h2>
						<Input
							bind:value={currentTopicStore.topic.title}
							ariaLabel="タイトル"
							inline
							focusStyle="background"
							placeholder="タイトルを入力してください"
							readonly={!phaseEditable({ published: currentTopicStore.topic.published }, 'theme')}
							onchange={save}
						/>
					</h2>
				{/if}
			</div>
			<div class="admin-topic-detail-template__step-navi">
				<StepNav
					{topicId}
					{currentPhase}
					phaseStatus={currentTopicStore.topic?.phaseStatus ?? 'not_started'}
					published={currentTopicStore.topic?.published ?? false}
					currentPath={page.url.pathname}
				/>
			</div>
		</div>

		<div class="admin-topic-detail-template__body">
			{#if actions}
				<div class="admin-topic-detail-template__actions-pane">
					<div class="admin-topic-detail-template__actions-content">
						{@render actions()}
					</div>
				</div>
			{/if}

			<div class="admin-topic-detail-template__contents-pane">
				{#if progress}
					<div class="admin-topic-detail-template__progress">
						{@render progress()}
					</div>
				{/if}

				{#if content}
					{@render content()}
				{/if}
			</div>
		</div>
	</div>
</AdminTemplate>

<style>
	.admin-topic-detail-template {
		display: grid;
		grid-template-rows: auto 1fr;
		height: 100%;
		overflow: hidden;
		background-color: var(--white);
	}

	.admin-topic-detail-template__header {
		border-bottom: solid 1px var(--svelte-ui-border-color);

		.admin-topic-detail-template__title-row {
			display: flex;
			align-items: center;
			padding: 12px 16px;

			h2 {
				font-size: 1.5rem;
				font-weight: bold;
			}
		}

		.admin-topic-detail-template__step-navi {
			padding: 8px 12px;
		}
	}

	.admin-topic-detail-template__body {
		overflow: auto;
		background: var(--base-50);
	}

	.admin-topic-detail-template__actions-pane {
		position: sticky;
		top: 0;
		padding: 24px;
		background-color: color-mix(in srgb, var(--base-50) 50%, transparent);
		backdrop-filter: blur(6px);
		z-index: 100;
	}

	.admin-topic-detail-template__actions-content {
		max-width: 960px;
		margin: 0 auto;
	}

	.admin-topic-detail-template__contents-pane {
		padding: 0 24px 24px;
	}

	.admin-topic-detail-template__progress {
		margin-bottom: 12px;
	}
</style>
