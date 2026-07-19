<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import { Dialog } from '@14ch/svelte-ui';
	import type { Persona, DraftBelief } from '$lib/models/persona/persona.types';
	import type { SvelteComponent } from 'svelte';
	import { convertToHtml } from '$lib/utils/formatText';

	let { persona }: { persona: Persona } = $props();
	let dialogRef: SvelteComponent | undefined = $state();

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

	export const open = () => {
		dialogRef?.open();
	};

	const interview = $derived(persona.interview);
	const sources = $derived(interview?.sources ?? []);
	const belief = $derived(persona.beliefs[0]?.content ?? '');
</script>

<Dialog bind:this={dialogRef} title="ペルソナの信念" scrollable width="600px">
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
		{#if belief}
			<div class="interview-item__section">
				<p class="interview-item__section-label">③ 最終信念</p>
				<div class="interview-item__md-body interview-item__md-body--belief">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
					{@html md(belief)}
				</div>
			</div>
		{:else}
			信念を生成中
		{/if}
		{#if interview?.interviewRecord}
			<div class="interview-item__section">
				<p class="interview-item__section-label">取材記録</p>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurifyでサニタイズ済み -->
				<div class="interview-item__md-body">{@html md(interview.interviewRecord)}</div>
			</div>
		{/if}
	</div>
</Dialog>

<style>
	.interview-item__detail {
		display: flex;
		flex-direction: column;
		gap: 64px;
	}
	.interview-item__section-label {
		font-size: var(--svelte-ui-font-size-lg);
		font-weight: bold;
	}
	.interview-item__md-body {
		font-size: var(--svelte-ui-font-size-sm);
		word-break: break-word;
	}
	.interview-item__md-body :global(h1),
	.interview-item__md-body :global(h2),
	.interview-item__md-body :global(h3),
	.interview-item__md-body :global(h4) {
		font-weight: bold;
	}
	.interview-item__draft-belief {
		font-size: var(--svelte-ui-font-size-sm);
		margin: 0;
	}
	.interview-item__source-summary {
		font-size: var(--svelte-ui-font-size-sm);
	}
	.interview-item__source-entry ul {
		margin: 0;
	}
	.interview-item__source-entry li {
		font-size: var(--svelte-ui-font-size-sm);
	}
	.interview-item__source-entry a:hover {
		text-decoration: underline;
	}
	.interview-item__source-url {
		word-break: break-all;
	}
</style>
