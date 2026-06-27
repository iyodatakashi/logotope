<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import { Button } from '@14ch/svelte-ui';
	import type { Persona, DraftBelief } from '$lib/models/persona/persona.types';
	import type { TopicContext } from '$lib/models/topic/topic.types';
	import { currentTopicStore } from '$lib/stores/currentTopic.svelte';

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
	const initialBelief = $derived(persona.beliefs[0]?.content ?? '');

	let expanded = $state(false);

	const buildTopicContext = (topic: {
		description?: string;
		fetchedSourceContents?: { content: string }[];
	}): TopicContext | undefined => {
		const description = topic.description;
		const sourceContents = topic.fetchedSourceContents?.map((fc) => fc.content);
		if (!description && !sourceContents?.length) return undefined;
		return { description, sourceContents };
	};

	const handleRetry = async () => {
		const topic = currentTopicStore.topic;
		if (!topic) return;
		const personasStore = currentTopicStore.personasStore;
		const topicContext = buildTopicContext(topic);
		// 再実行前に stopped→running へ戻す。これがないとサーバの完了確定（running 限定）が
		// no-op となり、全件完了しても generated に到達しない。完了確定はサーバ権威で行う。
		await personasStore.markInterviewsStarted();
		try {
			await personasStore.runInterview(persona.id, topic.title, topicContext);
		} catch {
			// サーバが当該ペルソナを error 永続化済み。再取材導線を出すため stopped に戻す。
			await personasStore.markInterviewsStopped();
		}
	};
</script>

<li
	class="item"
	class:item-completed={interview?.status === 'completed'}
	class:item-error={interview?.status === 'error'}
	class:item-pending={!interview}
>
	<div class="toggle-row">
		<button class="toggle" onclick={() => (expanded = !expanded)}>
			<span class="name-role">
				<strong>{persona.name}</strong>
				<span class="role">{role}</span>
			</span>
			<span
				class="status-badge"
				class:done={interview?.status === 'completed'}
				class:active={interview?.status === 'in_progress'}
				class:err={interview?.status === 'error'}
			>
				{#if interview?.status === 'completed'}完了
				{:else if interview?.status === 'in_progress'}取材中
				{:else if interview?.status === 'error'}エラー
				{:else}待機中{/if}
			</span>
			{#if initialBelief}
				<span class="arrow">{expanded ? '▲' : '▼'}</span>
			{/if}
		</button>
		{#if interview?.status === 'error'}
			<Button variant="outlined" onclick={handleRetry}>リトライ</Button>
		{/if}
	</div>

	{#if expanded && initialBelief}
		<div class="detail">
			{#if interview?.draftBelief}
				<div class="section">
					<p class="section-label">① ドラフト信念（ステレオタイプ仮説）</p>
					<dl class="draft-belief">
						{#each DRAFT_LABELS as { key, label } (key)}
							<dt>{label}</dt>
							<dd>{interview.draftBelief[key]}</dd>
						{/each}
					</dl>
				</div>
			{/if}
			{#if interview?.verificationReport}
				<div class="section">
					<p class="section-label">② リサーチに基づく検証（ギャップ）</p>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
					<div class="md-body">{@html md(interview.verificationReport)}</div>
				</div>
			{/if}
			{#if sources.length > 0}
				<div class="section">
					<p class="section-label">参照元</p>
					{#each sources as source (source.query)}
						<div class="source-entry">
							<p class="source-summary">{source.summary}</p>
							<ul>
								{#each source.results as result (result.url)}
									<li>
										<a
											class="source-url"
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
				<div class="section">
					<p class="section-label">リサーチ内容</p>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
					<div class="md-body">{@html md(interview.researchSummary)}</div>
				</div>
			{/if}
			<div class="section">
				<p class="section-label">③ 最終信念</p>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
				<div class="md-body belief">{@html md(initialBelief)}</div>
			</div>
			{#if interview?.interviewRecord}
				<div class="section">
					<p class="section-label">取材記録</p>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
					<div class="md-body">{@html md(interview.interviewRecord)}</div>
				</div>
			{/if}
		</div>
	{/if}
</li>

<style>
	.item {
		border: 1px solid #e0e0e0;
		border-radius: 8px;
		margin-bottom: 6px;
		overflow: hidden;
	}
	.item-completed {
		border-color: #a5d6a7;
		background: #f9fff9;
	}
	.item-error {
		border-color: #ef9a9a;
		background: #fff9f9;
	}
	.item-pending {
		border-color: #90caf9;
		background: #f5f9ff;
	}
	.toggle-row {
		display: flex;
		align-items: center;
	}
	.toggle {
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
	.toggle:hover {
		background: rgba(0, 0, 0, 0.03);
	}
	.name-role {
		display: flex;
		flex-direction: column;
		flex: 1;
	}
	.role {
		font-size: 0.75rem;
		color: #757575;
	}
	.status-badge {
		padding: 2px 8px;
		background: #e3f2fd;
		color: #1565c0;
		border-radius: 12px;
		font-size: 0.75rem;
		flex-shrink: 0;
	}
	.status-badge.done {
		background: #c8e6c9;
		color: #2e7d32;
	}
	.status-badge.active {
		background: #bbdefb;
		color: #1565c0;
		font-weight: 600;
	}
	.status-badge.err {
		background: #ffcdd2;
		color: #c62828;
	}
	.arrow {
		color: #757575;
		flex-shrink: 0;
	}
	.detail {
		border-top: 1px solid #e0e0e0;
	}
	.section {
		padding: 10px 12px;
		border-bottom: 1px solid #f0f0f0;
	}
	.section:last-child {
		border-bottom: none;
	}
	.section-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #757575;
		margin: 0 0 6px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.md-body {
		font-size: 0.875rem;
		line-height: 1.7;
		word-break: break-word;
		color: #333;
	}
	.md-body.belief {
		color: #1a237e;
	}
	.md-body :global(h1),
	.md-body :global(h2),
	.md-body :global(h3),
	.md-body :global(h4) {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 12px 0 4px;
	}
	.md-body :global(p) {
		margin: 4px 0;
	}
	.md-body :global(ul),
	.md-body :global(ol) {
		margin: 4px 0;
		padding-left: 20px;
	}
	.md-body :global(li) {
		margin: 2px 0;
	}
	.md-body :global(a) {
		color: #1565c0;
	}
	.md-body :global(code) {
		background: #f0f0f0;
		padding: 1px 4px;
		border-radius: 3px;
	}
	.draft-belief {
		font-size: 0.875rem;
		margin: 0;
	}
	.draft-belief dt {
		font-weight: 600;
		color: #555;
		margin-top: 8px;
	}
	.draft-belief dd {
		margin: 2px 0 0;
		white-space: pre-wrap;
		word-break: break-word;
		color: #333;
	}
	.source-entry {
		margin-bottom: 12px;
		padding-bottom: 12px;
		border-bottom: 1px dashed #e0e0e0;
	}
	.source-entry:last-child {
		border-bottom: none;
		margin-bottom: 0;
		padding-bottom: 0;
	}
	.source-summary {
		font-size: 0.875rem;
		color: #333;
		margin: 0 0 6px;
		line-height: 1.6;
	}
	.source-entry ul {
		margin: 0;
		padding-left: 16px;
	}
	.source-entry li {
		font-size: 0.8rem;
		margin-bottom: 6px;
	}
	.source-entry a {
		color: #1565c0;
		text-decoration: none;
	}
	.source-entry a:hover {
		text-decoration: underline;
	}
	.source-url {
		display: block;
		font-size: 0.7rem;
		color: #999;
		word-break: break-all;
	}
</style>
