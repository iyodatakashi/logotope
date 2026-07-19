<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import { Button } from '@14ch/svelte-ui';
	import type { Persona, DraftBelief } from '$lib/models/persona/persona.types';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';
	import { convertToHtml } from '$lib/utils/formatText';

	let { persona }: { persona: Persona } = $props();

	const md = (text: string): string =>
		DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: true }));

	const DRAFT_LABELS: { key: keyof DraftBelief; label: string }[] = [
		{ key: 'stanceAndGrounds', label: '立場と根拠' },
		{ key: 'coreClaims', label: '核心的主張' },
		{ key: 'concerns', label: '懸念事項' },
		{ key: 'values', label: '価値観' },
		{ key: 'compromisePoints', label: '妥協点' },
		{ key: 'changePotential', label: '変化の可能性' }
	];

	const role = $derived(persona.specificRole ?? persona.stakeholderRole);
	const interview = $derived(persona.interview);
	const sources = $derived(interview?.sources ?? []);
	const belief = $derived(persona.beliefs[0]?.content ?? '');

	let expanded = $state(false);

	const handleRetry = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		const personasStore = currentTopicStore.personasStore;
		// 再実行前に stopped→running へ戻す。これがないとサーバの完了確定（running 限定）が
		// no-op となり、全件完了しても generated に到達しない。完了確定はサーバ権威で行う。
		await personasStore.setPersonasPhaseRunning();
		try {
			await personasStore.runInterview(persona.id, topic.title);
		} catch {
			// サーバが当該ペルソナを error 永続化済み。再取材導線を出すため stopped に戻す。
			await personasStore.setPersonasPhaseStopped();
		}
	};
</script>

<li
	class="interview-item"
	class:interview-item--completed={interview?.status === 'completed'}
	class:interview-item--error={interview?.status === 'error'}
	class:interview-item--pending={!interview}
>
	<div class="interview-item__toggle-row">
		<button class="interview-item__toggle" onclick={() => (expanded = !expanded)}>
			<span class="interview-item__name-role">
				<strong>{persona.name}</strong>
				<span class="interview-item__role">{role}</span>
			</span>
			<span
				class="interview-item__status-badge"
				class:interview-item__status-badge--done={interview?.status === 'completed'}
				class:interview-item__status-badge--active={interview?.status === 'in_progress'}
				class:interview-item__status-badge--err={interview?.status === 'error'}
			>
				{#if interview?.status === 'completed'}完了
				{:else if interview?.status === 'in_progress'}取材中
				{:else if interview?.status === 'error'}エラー
				{:else}待機中{/if}
			</span>
			{#if belief}
				<span class="interview-item__arrow">{expanded ? '▲' : '▼'}</span>
			{/if}
		</button>
		{#if interview?.status === 'error'}
			<Button variant="outlined" onclick={handleRetry}>リトライ</Button>
		{/if}
	</div>

	{#if expanded && belief}
		<div class="interview-item__detail">
			{#if interview?.draftBelief}
				<div class="interview-item__section">
					<p class="interview-item__section-label">① ドラフト信念（ステレオタイプ仮説）</p>
					<dl class="interview-item__draft-belief">
						{#each DRAFT_LABELS as { key, label } (key)}
							<dt>{label}</dt>
							<dd>{@html convertToHtml(interview.draftBelief[key])}</dd>
						{/each}
					</dl>
				</div>
			{/if}
			{#if interview?.verificationReport}
				<div class="interview-item__section">
					<p class="interview-item__section-label">② リサーチに基づく検証（ギャップ）</p>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
					<div class="interview-item__md-body">{@html md(interview.verificationReport)}</div>
				</div>
			{/if}
			{#if sources.length > 0}
				<div class="interview-item__section">
					<p class="interview-item__section-label">参照元</p>
					{#each sources as source (source.query)}
						<div class="interview-item__source-entry">
							<p class="interview-item__source-summary">{source.summary}</p>
							<ul>
								{#each source.results as result (result.url)}
									<li>
										<a
											class="interview-item__source-url"
											href={result.url}
											target="_blank"
											rel="noopener noreferrer">{result.url}</a
										>
									</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			{:else if interview?.researchSummary}
				<div class="interview-item__section">
					<p class="interview-item__section-label">リサーチ内容</p>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
					<div class="interview-item__md-body">{@html md(interview.researchSummary)}</div>
				</div>
			{/if}
			<div class="interview-item__section">
				<p class="interview-item__section-label">③ 最終信念</p>
				<div class="interview-item__md-body interview-item__md-body--belief">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
					{@html md(belief)}
				</div>
			</div>
			{#if interview?.interviewRecord}
				<div class="interview-item__section">
					<p class="interview-item__section-label">取材記録</p>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
					<div class="interview-item__md-body">{@html md(interview.interviewRecord)}</div>
				</div>
			{/if}
		</div>
	{/if}
</li>

<style>
	.interview-item {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		margin-bottom: 6px;
		overflow: hidden;
	}
	.interview-item--completed {
		border-color: #a5d6a7;
		background: #f9fff9;
	}
	.interview-item--error {
		border-color: #ef9a9a;
		background: #fff9f9;
	}
	.interview-item--pending {
		border-color: #90caf9;
		background: #f5f9ff;
	}
	.interview-item__toggle-row {
		display: flex;
		align-items: center;
	}
	.interview-item__toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		padding: 10px 12px;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}
	.interview-item__toggle:hover {
		background: rgba(0, 0, 0, 0.03);
	}
	.interview-item__name-role {
		display: flex;
		flex-direction: column;
		flex: 1;
	}
	.interview-item__role {
		font-size: var(--svelte-ui-font-size-sm);
		color: #757575;
	}
	.interview-item__status-badge {
		padding: 2px 8px;
		background: #e3f2fd;
		color: #1565c0;
		border-radius: 12px;
		font-size: var(--svelte-ui-font-size-sm);
		flex-shrink: 0;
	}
	.interview-item__status-badge.interview-item__status-badge--done {
		background: #c8e6c9;
		color: #2e7d32;
	}
	.interview-item__status-badge.interview-item__status-badge--active {
		background: #bbdefb;
		color: #1565c0;
		font-weight: 600;
	}
	.interview-item__status-badge.interview-item__status-badge--err {
		background: #ffcdd2;
		color: #c62828;
	}
	.interview-item__arrow {
		color: #757575;
		flex-shrink: 0;
	}
	.interview-item__detail {
		border-top: 1px solid #e0e0e0;
	}
	.interview-item__section {
		padding: 10px 12px;
		border-bottom: 1px solid #f0f0f0;
	}
	.interview-item__section:last-child {
		border-bottom: none;
	}
	.interview-item__section-label {
		font-size: var(--svelte-ui-font-size-sm);
		font-weight: bold;
	}
	.interview-item__md-body {
		font-size: var(--svelte-ui-font-size-sm);
		word-break: break-word;
	}
	.interview-item__md-body.interview-item__md-body--belief {
		color: #1a237e;
	}
	.interview-item__md-body :global(h1),
	.interview-item__md-body :global(h2),
	.interview-item__md-body :global(h3),
	.interview-item__md-body :global(h4) {
		font-weight: bold;
		margin: 12px 0 4px;
	}
	.interview-item__md-body :global(p) {
		margin: 4px 0;
	}
	.interview-item__md-body :global(ul),
	.interview-item__md-body :global(ol) {
		margin: 4px 0;
		padding-left: 20px;
	}
	.interview-item__md-body :global(li) {
		margin: 2px 0;
	}
	.interview-item__md-body :global(a) {
		color: #1565c0;
	}
	.interview-item__md-body :global(code) {
		background: #f0f0f0;
		padding: 1px 4px;
		border-radius: 3px;
	}
	.interview-item__draft-belief {
		font-size: var(--svelte-ui-font-size-sm);
		margin: 0;
	}
	.interview-item__draft-belief dt {
		font-weight: 600;
		color: #555;
		margin-top: 8px;
	}
	.interview-item__draft-belief dd {
		word-break: break-word;
	}
	.interview-item__source-entry {
		margin-bottom: 12px;
		padding-bottom: 12px;
		border-bottom: 1px dashed #e0e0e0;
	}
	.interview-item__source-entry:last-child {
		border-bottom: none;
		margin-bottom: 0;
		padding-bottom: 0;
	}
	.interview-item__source-summary {
		font-size: var(--svelte-ui-font-size-sm);
	}
	.interview-item__source-entry li {
		font-size: var(--svelte-ui-font-size-sm);
	}
	.interview-item__source-entry a:hover {
		text-decoration: underline;
	}
	.interview-item__source-url {
		display: block;
		font-size: var(--svelte-ui-font-size-sm);
		word-break: break-all;
	}
</style>
